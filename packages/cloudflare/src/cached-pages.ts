// Workers Cache を有効にする内側のエントリポイント `CachedPages` (Issue #25)。
// Gateway (worker.ts の default) から `ctx.exports.CachedPages({ props }).fetch(...)` で呼ばれ、
// キャッシュに無いときだけ実行される。DO へ転送し、Workers Cache に保存させる形に応答を整える。
//
// Durable Object 自体の応答は Workers Cache の対象にならないため、キャッシュさせたい応答は
// この WorkerEntrypoint を経由させる (https://developers.cloudflare.com/workers/cache/#cache-durable-object-responses)。
// wrangler.jsonc の `exports` で、このエントリポイントだけキャッシュを有効にする。
import { WorkerEntrypoint } from "cloudflare:workers";
import { toCacheableResponse } from "./cache-policy.ts";
import type { CachedPagesProps } from "./cache-policy.ts";
import { getGame, resolveGameStubOptions } from "./do-stub.ts";
import type { GameStubOptions } from "./do-stub.ts";
import type { Env } from "./env.ts";

/** `createCachedPages` のオプション。`createWorker` と同じ値を渡す。 */
export type CreateCachedPagesOptions = GameStubOptions;

/** 既定の設定 (DO の binding 名 `GAME`) の `CachedPages`。 */
export class CachedPages extends WorkerEntrypoint<Env, CachedPagesProps> {
  /** DO の取得方法。`createCachedPages` が作るサブクラスで上書きする。 */
  protected gameStubOptions(): GameStubOptions {
    return {};
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
