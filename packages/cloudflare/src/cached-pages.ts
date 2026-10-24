// Workers Cache を有効にする内側のエントリポイント `CachedPages` (Issue #25)。
// Gateway (worker.ts の default) から `ctx.exports.CachedPages({ props }).fetch(...)` で呼ばれ、
// キャッシュに無いときだけ実行される。DO へ転送し、Workers Cache に保存させる形に応答を整える。
//
// Durable Object 自体の応答は Workers Cache の対象にならないため、キャッシュさせたい応答は
// この WorkerEntrypoint を経由させる (https://developers.cloudflare.com/workers/cache/#cache-durable-object-responses)。
// wrangler.jsonc の `exports` で、このエントリポイントだけキャッシュを有効にする。
import { cache as moduleCache, WorkerEntrypoint } from "cloudflare:workers";
import { toCacheableResponse } from "./cache-policy.ts";
import type { CachedPagesProps } from "./cache-policy.ts";
import { getGame, resolveGameStubOptions } from "./do-stub.ts";
import type { GameStubOptions } from "./do-stub.ts";
import type { Env } from "./env.ts";

/** `CachedPages.purgeEverything` の結果 (RPC で返すため、プレーンなオブジェクトにする)。 */
export interface CachePurgeOutcome {
  success: boolean;
  /** true なら purge の API が無い (テスト環境など)。 */
  unsupported?: boolean;
  errors: { code: number; message: string }[];
}

/**
 * purge の API。Workers Cache の `ctx.cache` (または `cloudflare:workers` の `cache`)。
 * キャッシュが無効な環境やテスト環境 (miniflare) では存在しないことがある。
 */
function purgeApiOf(ctx: ExecutionContext): CacheContext | undefined {
  const candidates: unknown[] = [ctx.cache, moduleCache];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { purge?: unknown }).purge === "function"
    ) {
      return candidate as CacheContext;
    }
  }
  return undefined;
}

/** `createCachedPages` のオプション。`createWorker` と同じ値を渡す。 */
export type CreateCachedPagesOptions = GameStubOptions;

/** 既定の設定 (DO の binding 名 `GAME`) の `CachedPages`。 */
export class CachedPages extends WorkerEntrypoint<Env, CachedPagesProps> {
  /** DO の取得方法。`createCachedPages` が作るサブクラスで上書きする。 */
  protected gameStubOptions(): GameStubOptions {
    return {};
  }

  /**
   * このエントリポイント (CachedPages) のキャッシュをすべて消す (RPC。DO から
   * `ctx.exports.CachedPages.purgeEverything()` で呼ぶ)。purge はそれを呼んだエントリポイントの
   * キャッシュにしか効かないため、キャッシュを持つ CachedPages 自身で呼ぶ。
   * purge は回数に上限 (Free プラン相当: 5 回/分) があり、超えると `success: false` になる。
   * 例外は投げず、結果を返す。
   */
  async purgeEverything(): Promise<CachePurgeOutcome> {
    const api = purgeApiOf(this.ctx);
    if (api === undefined) {
      return {
        success: false,
        unsupported: true,
        errors: [{ code: 0, message: "Workers Cache の purge API (ctx.cache.purge) がありません" }],
      };
    }
    try {
      const result = await api.purge({ purgeEverything: true });
      return {
        success: result.success,
        errors: result.errors.map((error) => ({ code: error.code, message: error.message })),
      };
    } catch (err) {
      return { success: false, errors: [{ code: -1, message: String(err) }] };
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const game = getGame(this.env, resolveGameStubOptions(this.gameStubOptions()));
    const response = await game.fetch(request);
    return toCacheableResponse(response);
  }
}

/**
 * DO の binding 名などを既定値から変えた `CachedPages` を作る。`createWorker` に渡したのと同じ
 * オプションを渡し、利用側のエントリで `export const CachedPages = createCachedPages({ ... })`
 * とする (エクスポート名は wrangler.jsonc の `exports` のキーと一致させる必要がある)。
 */
export function createCachedPages(options: CreateCachedPagesOptions = {}): typeof CachedPages {
  return class extends CachedPages {
    protected override gameStubOptions(): GameStubOptions {
      return options;
    }
  };
}
