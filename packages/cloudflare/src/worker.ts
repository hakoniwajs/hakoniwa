// tmp/12-workers-adapter.md 「Worker エントリ」節の実装。
// Worker (default エントリポイント = Gateway) は基本的にすべてのリクエストを単一の DO
// (`GAME.getByName('main')`) へ転送するだけ。静的アセット (images/style.css/owner.js) は
// wrangler.jsonc の assets 設定によりこの fetch より先に Workers Static Assets が応答する。
//
// Workers Cache (Issue #25): Gateway 自体はキャッシュを無効にし (wrangler.jsonc の `exports`)、
// キャッシュしてよいリクエストだけを、キャッシュを有効にした内側のエントリポイント
// `CachedPages` (cached-pages.ts) へ `ctx.exports` 経由で渡す。どのリクエストを渡すか、
// props・キャッシュキー・ブラウザへ返すヘッダは cache-policy.ts の純粋な関数で決める。
// 現在 CachedPages 経由にしているのは OGP 画像 (`/games/:gameId/islands/:id/ogp.png`) だけで、
// それ以外は DO へ直接転送する。応答ごとの `Cache-Control` (OGP 画像は `public, max-age=...`、
// それ以外は `private, no-store`) は `packages/core/src/web/app.tsx` の
// `defaultCacheControlMiddleware` / `routes/islands.tsx` が付ける。
//
// tmp/21-kv-snapshot-cache.md: 未ログイン (セッション Cookie 無し) の GET `/games/:gameId`
// (トップ) と `/games/:gameId/islands/:id` (観光) だけは、DO への往復を省くために View Model
// を Workers KV (`env.SNAPSHOT`。バインド省略可能) にキャッシュし、Worker 側でレンダリングして
// 応答する (`tryServeFromSnapshot`)。HTML 自体はキャッシュしない (`Cache-Control` は他のページと
// 同じく `private, no-store`) ので、「次のターンまであと N 分」はリクエスト時刻で再計算され古くならない。
// 対象外・KV 未バインド・キャッシュにも DO にも無ければ、通常どおり DO への HTTP 転送に委ねる。
// サイト設定 (タイトル・フッタ・タイムゾーン等) は管理画面から変わり DO の settings 表にあるため、
// 環境変数からは読まず、DO の `pageSnapshot` が返したものを KV (`siteSnapshotKey()`、短期 TTL) に
// 置いて使う。View Model とサイト設定の両方が KV にあるときだけ hit として KV から応答する。
import { renderIslandPageHtml, renderTopPageHtml } from "@hakoniwajs/core";
import { CachedPages } from "./cached-pages.ts";
import { CACHED_PAGES_ENTRYPOINT, planGatewayRequest, toBrowserResponse } from "./cache-policy.ts";
import type { CachedPagesProps } from "./cache-policy.ts";
import { getGame, resolveGameStubOptions } from "./do-stub.ts";
import type { GameStubOptions } from "./do-stub.ts";
import type { Env } from "./env.ts";
import { HakoniwaGame, loadWorkerConfig } from "./game-object.ts";
import {
  fromIslandPageSnapshotVM,
  islandSnapshotKey,
  siteSnapshotKey,
  topSnapshotKey,
} from "./snapshot.ts";
import type {
  IslandPageSnapshotEnvelope,
  PageSnapshotResult,
  SiteSnapshotEnvelope,
  TopPageSnapshotEnvelope,
} from "./snapshot.ts";

/** `createWorker` のオプション。`createCachedPages` にも同じ値を渡す。 */
export type CreateWorkerOptions = GameStubOptions;

/** `/games/:gameId` (トップ)。 */
const TOP_PATH = /^\/games\/([0-9]+)$/;
/** `/games/:gameId/islands/:id` (観光)。 */
const ISLAND_PATH = /^\/games\/([0-9]+)\/islands\/([0-9]+)$/;

/**
 * セッション Cookie の判定。tmp/21-kv-snapshot-cache.md: better-auth の `cookiePrefix` は
 * `hako` (`bootstrap/auth.ts`) なので、Cookie ヘッダに `hako` を含むものがあれば
 * ログイン中の可能性ありとみなし DO へ転送する (安全側の単純な部分一致判定)。
 */
function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("Cookie");
  return cookie !== null && cookie.includes("hako");
}

function snapshotResponse(html: string, status: "hit" | "miss"): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      // HTML 自体はキャッシュしない (KV に置くのは View Model のみ)。
      "Cache-Control": "private, no-store",
      "X-Hakoniwa-Snapshot": status,
    },
  });
}

/** DO への通常の転送応答に `X-Hakoniwa-Snapshot: bypass` を付け足す (動作確認用)。 */
function withBypassHeader(response: Response): Response {
  const copy = new Response(response.body, response);
  copy.headers.set("X-Hakoniwa-Snapshot", "bypass");
  return copy;
}

/** DO から受け取ったページの View Model とサイト設定を、それぞれの TTL で KV に保存する。 */
async function putSnapshots(
  snapshot: KVNamespace,
  key: string,
  result: PageSnapshotResult,
): Promise<void> {
  const siteEnvelope: SiteSnapshotEnvelope = { site: result.site };
  await Promise.all([
    snapshot.put(key, JSON.stringify({ vm: result.vm }), { expirationTtl: result.ttl }),
    snapshot.put(siteSnapshotKey(), JSON.stringify(siteEnvelope), {
      expirationTtl: result.siteTtl,
    }),
  ]);
}

/**
 * 未ログイン GET の `/games/:gameId` / `/games/:gameId/islands/:id` を KV スナップショット
 * (View Model の JSON) から応答する。対象外リクエスト、`env.SNAPSHOT` 未バインド、
 * キャッシュにも DO 側にも対象が無い場合は `undefined` を返す
 * (呼び出し側が DO への HTTP 転送にフォールバックする)。
 */
async function tryServeFromSnapshot(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  options: Required<GameStubOptions>,
): Promise<Response | undefined> {
  const snapshot = env.SNAPSHOT;
  if (request.method !== "GET" || snapshot === undefined || hasSessionCookie(request)) {
    return undefined;
  }
  const url = new URL(request.url);
  // 対象は素の GET (クエリ文字列無し) のみにする。エラー通知のリダイレクト
  // (`/games/:id?notice=no_island` 等) はログイン中のユーザー向けの導線なので、通常は
  // セッション Cookie 判定で既に弾かれているはずだが、クエリ文字列があれば常に DO の通常経路
  // (`app.onError` 由来の表示分岐など) に委ねる方が安全なため、ここでも対象外にする。
  if (url.search !== "") {
    return undefined;
  }

  const topMatch = TOP_PATH.exec(url.pathname);
  const islandMatch = topMatch === null ? ISLAND_PATH.exec(url.pathname) : null;
  if (topMatch === null && islandMatch === null) {
    return undefined;
  }

  const config = loadWorkerConfig(env);
  const now = Math.floor(Date.now() / 1000);

  if (topMatch !== null) {
    const gameId = Number(topMatch[1]);
    const key = topSnapshotKey(gameId);

    const [cached, cachedSite] = await Promise.all([
      snapshot.get<TopPageSnapshotEnvelope>(key, "json"),
      snapshot.get<SiteSnapshotEnvelope>(siteSnapshotKey(), "json"),
    ]);
    if (cached !== null && cachedSite !== null) {
      const html = await renderTopPageHtml({
        vm: cached.vm,
        config: config.game,
        site: cachedSite.site,
        now,
      });
      return snapshotResponse(html, "hit");
    }

    const result = await getGame(env, options).pageSnapshot({ kind: "top", gameId });
    if (result === undefined) {
      return undefined;
    }
    if (result.kind !== "top") {
      throw new Error("HakoniwaGame.pageSnapshot: expected kind 'top'");
    }
    const html = await renderTopPageHtml({
      vm: result.vm,
      config: config.game,
      site: result.site,
      now,
    });
    ctx.waitUntil(putSnapshots(snapshot, key, result));
    return snapshotResponse(html, "miss");
  }

  // topMatch === null の分岐なので islandMatch は必ず非 null (正規表現の相互排他性による)。
  if (islandMatch === null) {
    return undefined;
  }
  const gameId = Number(islandMatch[1]);
  const islandId = Number(islandMatch[2]);
  const key = islandSnapshotKey(gameId, islandId);
  const origin = config.auth.baseUrl ?? url.origin;

  const [cached, cachedSite] = await Promise.all([
    snapshot.get<IslandPageSnapshotEnvelope>(key, "json"),
    snapshot.get<SiteSnapshotEnvelope>(siteSnapshotKey(), "json"),
  ]);
  if (cached !== null && cachedSite !== null) {
    const vm = fromIslandPageSnapshotVM(cached.vm, config.game.islandSize);
    const html = await renderIslandPageHtml({
      vm,
      config: config.game,
      site: cachedSite.site,
      origin,
    });
    return snapshotResponse(html, "hit");
  }

  const result = await getGame(env, options).pageSnapshot({ kind: "island", gameId, islandId });
  if (result === undefined) {
    return undefined;
  }
  if (result.kind !== "island") {
    throw new Error("HakoniwaGame.pageSnapshot: expected kind 'island'");
  }
  const vm = fromIslandPageSnapshotVM(result.vm, config.game.islandSize);
  const html = await renderIslandPageHtml({ vm, config: config.game, site: result.site, origin });
  ctx.waitUntil(putSnapshots(snapshot, key, result));
  return snapshotResponse(html, "miss");
}

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
      const snapshotRes = await tryServeFromSnapshot(request, env, ctx, resolved);
      if (snapshotRes !== undefined) {
        return snapshotRes;
      }
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
      return withBypassHeader(await getGame(env, resolved).fetch(request));
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
