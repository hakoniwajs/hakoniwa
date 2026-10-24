// DO (HakoniwaGame) から Workers Cache を purge する (Issue #25)。
//
// purge はそれを呼んだエントリポイントのキャッシュにしか効かないため、DO は
// `ctx.exports.CachedPages.purgeEverything()` (RPC) で CachedPages 自身に purge させる。
// purge は回数に上限 (Free プラン相当: 5 回/分) があるので、サイト設定の変更・ゲームの開始/終了・
// データの削除・バックアップの復元といった稀なイベントだけで使う (ページごとの無効化は、
// キャッシュ期間とキャッシュキー (props の rev) で行う)。
//
// 失敗しても例外は投げない (管理操作は成功させる)。失敗した場合は settings 表に印を残し、
// Cron (checkTurn、15 分ごと) でやり直す。
// バックアップの復元だけは例外で、purge に失敗したら復元を中止する (印は残さない。データは
// 変わっていないため)。
import { CachePurgeFailedError, type CachePurger, type SettingsRepository } from "@hakoniwajs/core";
import type { CachePurgeOutcome } from "./cached-pages.ts";
import { CACHED_PAGES_ENTRYPOINT } from "./cache-policy.ts";

/** purge に失敗したときに、やり直すための印を置く settings 表のキー (値は理由)。 */
export const CACHE_PURGE_PENDING_SETTINGS_KEY = "cache.purge_pending";

interface CachedPagesRpc {
  purgeEverything(): Promise<CachePurgeOutcome>;
}

/** 復元の直前に使う。失敗したときは `CachePurgeFailedError` を投げ、復元を進めない。 */
export interface RestoreCachePurger {
  purgeBeforeRestore(reason: string): Promise<void>;
}

function cachedPagesOf(ctx: DurableObjectState): CachedPagesRpc | undefined {
  const exports = (ctx as { exports?: unknown }).exports as Record<string, unknown> | undefined;
  const loopback = exports?.[CACHED_PAGES_ENTRYPOINT] as Partial<CachedPagesRpc> | undefined;
  return loopback !== undefined && typeof loopback.purgeEverything === "function"
    ? (loopback as CachedPagesRpc)
    : undefined;
}

type PurgeAttempt =
  | { status: "ok" }
  | { status: "failed"; errors: { code: number; message: string }[] };

export class DurableObjectCachePurger implements CachePurger, RestoreCachePurger {
  readonly #ctx: DurableObjectState;
  readonly #settings: SettingsRepository;

  constructor(ctx: DurableObjectState, settings: SettingsRepository) {
    this.#ctx = ctx;
    this.#settings = settings;
  }

  async purgeAll(reason: string): Promise<void> {
    const attempt = await this.#invoke(reason);
    if (attempt.status === "failed") {
      console.error(
        `hakoniwa: キャッシュの purge に失敗しました (${reason})。Cron でやり直します`,
        attempt.errors,
      );
      this.#settings.set(CACHE_PURGE_PENDING_SETTINGS_KEY, reason);
    }
  }

  /**
   * 復元の前に呼ぶ。レート制限などで失敗したら例外を投げ、印は残さない
   * (この時点ではデータを変えていない)。API が無い、CachedPages が無い場合は戻る。
   */
  async purgeBeforeRestore(reason: string): Promise<void> {
    const attempt = await this.#invoke(reason);
    if (attempt.status === "failed") {
      console.error(
        `hakoniwa: キャッシュの purge に失敗したため復元を中止します (${reason})`,
        attempt.errors,
      );
      throw new CachePurgeFailedError(reason);
    }
  }

  /**
   * purge を実行する。成功と「API が無い / CachedPages が無い」は `ok`。
   * レート制限などの失敗は `failed` (呼び出し側が印を残すか、処理を中止する)。
   */
  async #invoke(reason: string): Promise<PurgeAttempt> {
    // CachedPages を再エクスポートしていない (キャッシュを使っていない) 設定なら何もしない。
    const cachedPages = cachedPagesOf(this.#ctx);
    if (cachedPages === undefined) {
      return { status: "ok" };
    }
    let outcome: CachePurgeOutcome;
    try {
      outcome = await cachedPages.purgeEverything();
    } catch (err) {
      outcome = { success: false, errors: [{ code: -1, message: String(err) }] };
    }
    if (outcome.success) {
      if (this.pendingReason() !== undefined) {
        this.#settings.set(CACHE_PURGE_PENDING_SETTINGS_KEY, "");
      }
      return { status: "ok" };
    }
    if (outcome.unsupported === true) {
      // purge の API が無い環境 (テスト環境や Workers Cache が無効な場合)。やり直しても同じなので
      // 印は残さない。キャッシュも無いので、復元は続行してよい。
      console.warn(`hakoniwa: キャッシュを purge できません (${reason})`, outcome.errors);
      return { status: "ok" };
    }
    return { status: "failed", errors: outcome.errors };
  }

  /** 失敗した purge の理由。無ければ undefined。 */
  pendingReason(): string | undefined {
    const value = this.#settings.get(CACHE_PURGE_PENDING_SETTINGS_KEY);
    return value === undefined || value === "" ? undefined : value;
  }

  /** 失敗した purge があればやり直す (Cron から呼ぶ)。 */
  async retryPending(): Promise<void> {
    const reason = this.pendingReason();
    if (reason !== undefined) {
      await this.purgeAll(`retry: ${reason}`);
    }
  }
}
