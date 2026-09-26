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
import type { CachePurger, SettingsRepository } from "@hakoniwajs/core";
import type { CachePurgeOutcome } from "./cached-pages.ts";
import { CACHED_PAGES_ENTRYPOINT } from "./cache-policy.ts";

/** purge に失敗したときに、やり直すための印を置く settings 表のキー (値は理由)。 */
export const CACHE_PURGE_PENDING_SETTINGS_KEY = "cache.purge_pending";

interface CachedPagesRpc {
  purgeEverything(): Promise<CachePurgeOutcome>;
}

function cachedPagesOf(ctx: DurableObjectState): CachedPagesRpc | undefined {
  const exports = (ctx as { exports?: unknown }).exports as Record<string, unknown> | undefined;
  const loopback = exports?.[CACHED_PAGES_ENTRYPOINT] as Partial<CachedPagesRpc> | undefined;
  return loopback !== undefined && typeof loopback.purgeEverything === "function"
    ? (loopback as CachedPagesRpc)
    : undefined;
}

export class DurableObjectCachePurger implements CachePurger {
  readonly #ctx: DurableObjectState;
  readonly #settings: SettingsRepository;

  constructor(ctx: DurableObjectState, settings: SettingsRepository) {
    this.#ctx = ctx;
    this.#settings = settings;
  }

  async purgeAll(reason: string): Promise<void> {
    // CachedPages を再エクスポートしていない (キャッシュを使っていない) 設定なら何もしない。
    const cachedPages = cachedPagesOf(this.#ctx);
    if (cachedPages === undefined) {
      return;
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
      return;
    }
    if (outcome.unsupported === true) {
      // purge の API が無い環境 (テスト環境や Workers Cache が無効な場合)。やり直しても同じなので
      // 印は残さない。
      console.warn(`hakoniwa: キャッシュを purge できません (${reason})`, outcome.errors);
      return;
    }
    console.error(
      `hakoniwa: キャッシュの purge に失敗しました (${reason})。Cron でやり直します`,
      outcome.errors,
    );
    this.#settings.set(CACHE_PURGE_PENDING_SETTINGS_KEY, reason);
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
