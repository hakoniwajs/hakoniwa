// tmp/12-workers-adapter.md 「Worker エントリ」節の実装。
// Worker は基本的にすべてのリクエストを単一の DO (`GAME.getByName('main')`) へ転送するだけ。
// 静的アセット (images/style.css/owner.js) は wrangler.jsonc の assets 設定により
// この fetch より先に Workers Static Assets が応答する。
//
// tmp/17-ogp.md 「キャッシュ」節 (方針変更): Cache API (`caches.default`) を自前で呼ぶ実装は
// 使わない。代わりに Workers Cache (`wrangler.jsonc` の `cache.enabled`) を使う。これは
// 応答の `Cache-Control` に従って Cloudflare 側が自動でキャッシュする機能で、workers.dev でも
// 有効。応答ごとの `Cache-Control` (OGP 画像は `public, max-age=3600` 等、それ以外は
// `private, no-store`) は `packages/core/src/web/app.tsx` の
// `defaultCacheControlMiddleware` / `routes/islands.tsx` が付ける。
//
// tmp/21-kv-snapshot-cache.md: 未ログイン (セッション Cookie 無し) の GET `/games/:gameId`
// (トップ) と `/games/:gameId/islands/:id` (観光) だけは、DO への往復を省くために View Model
// を Workers KV (`env.SNAPSHOT`。バインド省略可能) にキャッシュし、Worker 側でレンダリングして
// 応答する (`tryServeFromSnapshot`)。HTML 自体はキャッシュしない (`Cache-Control` は従来どおり
// `private, no-store`) ので、「次のターンまであと N 分」はリクエスト時刻で再計算され古くならない。
// 対象外・KV 未バインド・キャッシュにも DO にも無ければ、従来どおり DO への HTTP 転送に委ねる。
import { renderIslandPageHtml, renderTopPageHtml } from "@hakoniwajs/core";
import type { Env } from "./env.ts";
import { HakoniwaGame, loadWorkerConfig } from "./game-object.ts";
import { fromIslandPageSnapshotVM, islandSnapshotKey, topSnapshotKey } from "./snapshot.ts";
import type { IslandPageSnapshotEnvelope, TopPageSnapshotEnvelope } from "./snapshot.ts";

/** `createWorker` のオプション。 */
export interface CreateWorkerOptions {
  /**
   * wrangler.jsonc の `durable_objects.bindings` の binding 名 (既定 `"GAME"`)。
   * `class_name` は `HakoniwaGame` 固定で、このパッケージから再エクスポートされる。
   */
  doBinding?: string;
  /**
   * DO の初回作成時の location hint (既定 `"apac-ne"` (北東アジア)。プレイヤーは日本在住が
   * 中心のため)。効くのは DO の **初回作成時のみ** でベストエフォート。既存の DO は移動しない。
   * 変更する場合は次のいずれかから選ぶ: wnam, enam, sam, weur, eeur, apac, apac-ne, apac-se, oc, afr, me
   * (参考: https://developers.cloudflare.com/durable-objects/reference/data-location/#provide-a-location-hint)
   */
  locationHint?: DurableObjectLocationHint;
}

// DO の取得に location hint `apac-ne` (北東アジア) を指定する。
// 注意:
// - location hint が効くのは DO の **初回作成時のみ** で、ベストエフォート。既存の DO は移動しない。
// - プレイヤーは日本在住が中心のため `apac-ne` を選択している。
function getGame(env: Env, options: Required<CreateWorkerOptions>) {
  // binding 名は options.doBinding で変えられるため Env のプロパティを動的に引く。
  const namespace = (env as unknown as Record<string, unknown>)[options.doBinding] as
    | DurableObjectNamespace<HakoniwaGame>
    | undefined;
  if (namespace === undefined) {
    throw new Error(
      `hakoniwa: wrangler.jsonc の durable_objects.bindings に name: "${options.doBinding}" (class_name: "HakoniwaGame") がありません`,
    );
  }
  const id = namespace.idFromName("main");
  return namespace.get(id, { locationHint: options.locationHint });
}

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

/**
 * 未ログイン GET の `/games/:gameId` / `/games/:gameId/islands/:id` を KV スナップショット
 * (View Model の JSON) から応答する。対象外リクエスト、`env.SNAPSHOT` 未バインド、
 * キャッシュにも DO 側にも対象が無い場合は `undefined` を返す
 * (呼び出し側が従来どおり DO への HTTP 転送にフォールバックする)。
 */
async function tryServeFromSnapshot(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  options: Required<CreateWorkerOptions>,
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

    const cached = await snapshot.get<TopPageSnapshotEnvelope>(key, "json");
    if (cached !== null) {
      const html = await renderTopPageHtml({
        vm: cached.vm,
        config: config.game,
        timezone: config.timezone,
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
      timezone: config.timezone,
      now,
    });
    const envelope: TopPageSnapshotEnvelope = { vm: result.vm };
    ctx.waitUntil(snapshot.put(key, JSON.stringify(envelope), { expirationTtl: result.ttl }));
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

  const cached = await snapshot.get<IslandPageSnapshotEnvelope>(key, "json");
  if (cached !== null) {
    const vm = fromIslandPageSnapshotVM(cached.vm, config.game.islandSize);
    const html = await renderIslandPageHtml({ vm, config: config.game, origin });
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
  const html = await renderIslandPageHtml({ vm, config: config.game, origin });
  const envelope: IslandPageSnapshotEnvelope = { vm: result.vm };
  ctx.waitUntil(snapshot.put(key, JSON.stringify(envelope), { expirationTtl: result.ttl }));
  return snapshotResponse(html, "miss");
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
 * 箱庭諸島２の Worker エントリを組み立てるファクトリ。
 * 利用側は次の 3 行で Worker を構成できる (DO クラスは wrangler.jsonc の class_name で
 * 名前解決されるため、利用側のエントリから再エクスポートが必要):
 *
 * ```ts
 * import { createWorker } from "@hakoniwajs/cloudflare";
 * export { HakoniwaGame } from "@hakoniwajs/cloudflare";
 * export default createWorker();
 * ```
 */
export function createWorker(options: CreateWorkerOptions = {}): HakoniwaWorker {
  const resolved: Required<CreateWorkerOptions> = {
    doBinding: options.doBinding ?? "GAME",
    locationHint: options.locationHint ?? "apac-ne",
  };
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const snapshotRes = await tryServeFromSnapshot(request, env, ctx, resolved);
      if (snapshotRes !== undefined) {
        return snapshotRes;
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

export { HakoniwaGame };
