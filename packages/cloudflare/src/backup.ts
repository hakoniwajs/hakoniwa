// tmp/12-workers-adapter.md 「バックアップ: Point-in-Time Recovery」節の実装。
// SQLite backend の DO が持つ PITR ブックマークを `backups` 表 (04-database.md、schema.ts) の台帳で管理する。
import type { BackupInfo, BackupStore, CachePurger } from "@hakoniwajs/core";

const LABEL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * DO の PITR ブックマークによる `BackupStore` 実装。
 *
 * - `create`: `storage.getCurrentBookmark()` (現在時点のブックマーク) を `backups` 表に記録する。
 * - `restore`: 記録したブックマークを次回セッション開始時に復元するよう予約し、`ctx.abort()` で
 *   DO を再起動する。復元は非同期に行われるため、呼び出し元は「数秒後に再読み込み」を案内する。
 *   再起動の前に Workers Cache を purge する (再起動後は「復元した」ことが分からないため)。
 * - `rotate`: `backups` 表の古い行を削除するだけ (ブックマーク自体は Cloudflare 側で 30 日保持)。
 */
export class BookmarkBackupStore implements BackupStore {
  readonly #ctx: DurableObjectState;
  readonly #purger: CachePurger | undefined;

  constructor(ctx: DurableObjectState, purger?: CachePurger) {
    this.#ctx = ctx;
    this.#purger = purger;
  }

  #validateLabel(label: string): void {
    if (!LABEL_PATTERN.test(label)) {
      throw new Error(`BookmarkBackupStore: invalid label: ${JSON.stringify(label)}`);
    }
  }

  async list(): Promise<BackupInfo[]> {
    const rows = this.#ctx.storage.sql
      .exec<{ label: string; turn: number; created_at: number }>(
        "SELECT label, turn, created_at FROM backups ORDER BY created_at DESC",
      )
      .toArray();
    return rows.map((row) => ({ label: row.label, turn: row.turn, createdAt: row.created_at }));
  }

  async create(label: string, turn: number): Promise<void> {
    this.#validateLabel(label);
    const bookmark = await this.#ctx.storage.getCurrentBookmark();
    const createdAt = Math.floor(Date.now() / 1000);
    this.#ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO backups (label, bookmark, turn, created_at) VALUES (?, ?, ?, ?)",
      label,
      bookmark,
      turn,
      createdAt,
    );
  }

  async restore(label: string): Promise<void> {
    this.#validateLabel(label);
    const row = this.#ctx.storage.sql
      .exec<{ bookmark: string }>("SELECT bookmark FROM backups WHERE label = ?", label)
      .toArray()[0];
    if (row === undefined) {
      throw new Error(`BookmarkBackupStore: backup not found: ${label}`);
    }
    const bookmark = row.bookmark;
    // 復元の予約と purge の間に他のリクエストを処理させない (復元前の内容がキャッシュに
    // 入り直さないようにする)。purge の失敗は CachePurger がログに残す (失敗の印は settings 表に
    // 置くが、復元で消えるため Cron でのやり直しはされない)。
    await this.#ctx.blockConcurrencyWhile(async () => {
      await this.#ctx.storage.onNextSessionRestoreBookmark(bookmark);
      await this.#purger?.purgeAll("restore-backup");
    });
    // DO を再起動し、次回セッション開始時に上記ブックマークへ復元させる。
    this.#ctx.abort("hakoniwa: restoring backup");
  }

  async delete(label: string): Promise<void> {
    this.#validateLabel(label);
    this.#ctx.storage.sql.exec("DELETE FROM backups WHERE label = ?", label);
  }

  async rotate(keep: number): Promise<void> {
    const infos = await this.list();
    for (const info of infos.slice(keep)) {
      await this.delete(info.label);
    }
  }
}
