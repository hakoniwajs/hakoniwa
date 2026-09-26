// tmp/12-workers-adapter.md 「Worker エントリ」節の実装。
// Worker (default エントリポイント = Gateway) は基本的にすべてのリクエストを単一の DO
// (`GAME.getByName('main')`) へ転送するだけ。静的アセット (images/style.css/owner.js) は
// wrangler.jsonc の assets 設定によりこの fetch より先に Workers Static Assets が応答する。
//
// Workers Cache (Issue #25): Gateway 自体はキャッシュを無効にし (wrangler.jsonc の `exports`)、
// キャッシュしてよいリクエストだけを、キャッシュを有効にした内側のエントリポイント
// `CachedPages` (cached-pages.ts) へ `ctx.exports` 経由で渡す。どのリクエストを渡すか、
// props・キャッシュキー・ブラウザへ返すヘッダは cache-policy.ts の純粋な関数で決める。
// CachedPages 経由にしているのは、未ログインの GET のトップ・観光・ゲーム一覧ページと OGP 画像
// (`/games/:gameId/islands/:id/ogp.png`) で、それ以外は DO へ直接転送する。キャッシュしてよい期間は
// DO (`@hakoniwajs/core` の web/cache-hint.ts) が内部ヘッダで伝え、CachedPages が `Cache-Control`
// に変換する。ブラウザへ返す HTML の `Cache-Control` は常に `private, no-store`。
import { CachedPages } from "./cached-pages.ts";
import {
  CACHED_PAGES_ENTRYPOINT,
  planGatewayRequest,
  toBrowserResponse,
  toDirectResponse,
} from "./cache-policy.ts";
import type { CachedPagesProps } from "./cache-policy.ts";
import { getGame, resolveGameStubOptions } from "./do-stub.ts";
import type { GameStubOptions } from "./do-stub.ts";
import type { Env } from "./env.ts";
import { HakoniwaGame } from "./game-object.ts";

/** `createWorker` のオプション。`createCachedPages` にも同じ値を渡す。 */
export type CreateWorkerOptions = GameStubOptions;

/** `ctx.exports.CachedPages` (props 付きで呼べるループバックのサービスバインディング)。 */
type CachedPagesLoopback = (options: { props: CachedPagesProps }) => Fetcher;

/**
 * `ctx.exports` から CachedPages を取り出す。利用側のエントリが `CachedPages` を
 * 再エクスポートしていない (古い設定のまま) 場合は `undefined` を返し、呼び出し側は
 * キャッシュを使わずに DO へ直接転送する。
 */
function cachedPagesOf(ctx: ExecutionContext): CachedPagesLoopback | undefined {
  const exports = (ctx as { exports?: unknown }).exports as Record<string, unknown> | undefined;
  const loopback = exports?.[CACHED_PAGES_ENTRYPOINT];
  return typeof loopback === "function" ? (loopback as CachedPagesLoopback) : undefined;
}

/**
 * `createWorker()` が返す Worker オブジェクト。fetch/scheduled を持つ。
 * `ExportedHandler<Env>` 相当だが、`Request` は素の DOM 型のままにする
 * (`Request<unknown, IncomingRequestCfProperties>` にすると、テスト等で作った素の `Request`
 * を渡したとき `exactOptionalPropertyTypes` との組み合わせで型エラーになるため)。
 */
export interface HakoniwaWorker {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
}

/**
 * 箱庭諸島２の Worker エントリ (Gateway) を組み立てるファクトリ。
 * 利用側は次のように Worker を構成する (DO クラスは wrangler.jsonc の class_name で、
 * `CachedPages` は wrangler.jsonc の `exports` で名前解決されるため、利用側のエントリから
 * 再エクスポートが必要):
 *
 * ```ts
 * import { createWorker } from "@hakoniwajs/cloudflare";
 * export { CachedPages, HakoniwaGame } from "@hakoniwajs/cloudflare";
 * export default createWorker();
 * ```
 */
export function createWorker(options: CreateWorkerOptions = {}): HakoniwaWorker {
  const resolved = resolveGameStubOptions(options);
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const plan = planGatewayRequest(request);
      const cachedPages = cachedPagesOf(ctx);
      if (plan.kind === "cached" && cachedPages !== undefined) {
        const response = await cachedPages({ props: plan.props }).fetch(plan.url, {
          method: plan.method,
          headers: plan.headers,
          cf: { cacheKey: plan.cacheKey },
        });
        return toBrowserResponse(response);
      }
      return toDirectResponse(await getGame(env, resolved).fetch(request));
    },
    async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      // 進めるべきかどうか (unitTimeSec と game.last_time から判定) は DO 側 (checkTurn) に任せる。
      ctx.waitUntil(getGame(env, resolved).checkTurn());
    },
  };
}

// このリポジトリ自身のデプロイ用エントリ (root の wrangler.jsonc が main に指す)。
export default createWorker();

export { CachedPages, HakoniwaGame };
