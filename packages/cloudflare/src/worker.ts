// tmp/12-workers-adapter.md 「Worker エントリ」節の実装。
// Worker (default エントリポイント = Gateway) は基本的にすべてのリクエストを単一の DO
// (`GAME.getByName('main')`) へ転送するだけ。静的アセット (images/style.css/owner.js) は
// wrangler.jsonc の assets 設定によりこの fetch より先に Workers Static Assets が応答する。
//
// Workers Cache (Issue #25): Gateway 自体はキャッシュを無効にし (wrangler.jsonc の `exports`)、
// キャッシュしてよいリクエストだけを、キャッシュを有効にした内側のエントリポイント
// `CachedPages` (cached-pages.ts) へ `ctx.exports` 経由で渡す。どのリクエストを渡すか、
// props・キャッシュキー・ブラウザへ返すヘッダは cache-policy.ts の純粋な関数で決める。
// CachedPages 経由にしているのは、GET のトップ・観光・ゲーム一覧ページ (ログイン中は開発画面も)
// と OGP 画像 (`/games/:gameId/islands/:id/ogp.png`) で、それ以外は DO へ直接転送する。
// ログイン中のページは、better-auth のセッションの Cookie キャッシュ (署名付き) をエッジで
// 検証できた場合だけ、セッションごとの props でキャッシュする。キャッシュしてよい期間は
// DO (`@hakoniwajs/core` の web/cache-hint.ts) が内部ヘッダで伝え、CachedPages が `Cache-Control`
// に変換する。ブラウザへ返す HTML の `Cache-Control` は常に `private, no-store`。
import { verifySessionCookieCache } from "@hakoniwajs/core";
import type { AppConfig } from "@hakoniwajs/core";
import { CachedPages } from "./cached-pages.ts";
import {
  CACHED_PAGES_ENTRYPOINT,
  needsSessionVerification,
  planGatewayRequest,
  toBrowserResponse,
  toDirectResponse,
} from "./cache-policy.ts";
import type { CachedPagesProps, GatewaySession } from "./cache-policy.ts";
import { getGame, resolveGameStubOptions } from "./do-stub.ts";
import type { GameStubOptions } from "./do-stub.ts";
import type { Env } from "./env.ts";
import { HakoniwaGame, loadWorkerConfig } from "./game-object.ts";

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

/** DO から取得した auth secret を isolate 内で使い回す期間 (ミリ秒)。 */
const AUTH_SECRET_MEMO_TTL_MS = 10 * 60 * 1000;
/**
 * 検証に失敗したとき、DO から取得した auth secret を取り直してよい間隔 (ミリ秒)。settings 表の
 * secret が作り直された場合 (データの削除など) に備える。検証に失敗するリクエストを大量に
 * 送られても、DO への問い合わせはこの間隔に 1 回まで。
 */
const AUTH_SECRET_REFETCH_INTERVAL_MS = 60 * 1000;

interface AuthSecretMemo {
  secret: Promise<string>;
  fetchedAt: number;
}

/** DO の binding 名ごとの auth secret のメモ。 */
const authSecretMemo = new Map<string, AuthSecretMemo>();

/** テスト用: メモした auth secret を捨てる (テストごとに DO のデータを作り直すため)。 */
export function clearAuthSecretMemo(): void {
  authSecretMemo.clear();
}

/**
 * auth secret を決める。`HAKONIWA_AUTH_SECRET` があればそれ、無ければ DO の settings 表に
 * 自動生成して保存した値を DO の RPC (`authSecret`) で取得し、isolate 内でメモ化する
 * (一定時間で取り直す)。取得できなければ undefined (呼び出し側はキャッシュを使わない)。
 */
async function resolveAuthSecret(
  env: Env,
  options: Required<GameStubOptions>,
  now: number,
): Promise<{ secret: string; memo?: AuthSecretMemo } | undefined> {
  if (env.HAKONIWA_AUTH_SECRET !== undefined && env.HAKONIWA_AUTH_SECRET !== "") {
    return { secret: env.HAKONIWA_AUTH_SECRET };
  }
  let memo = authSecretMemo.get(options.doBinding);
  if (memo === undefined || now - memo.fetchedAt >= AUTH_SECRET_MEMO_TTL_MS) {
    memo = { secret: getGame(env, options).authSecret(), fetchedAt: now };
    authSecretMemo.set(options.doBinding, memo);
  }
  try {
    return { secret: await memo.secret, memo };
  } catch (err) {
    if (authSecretMemo.get(options.doBinding) === memo) {
      authSecretMemo.delete(options.doBinding);
    }
    console.error("hakoniwa: failed to get the auth secret from the Durable Object", err);
    return undefined;
  }
}

/** `env` ごとの AppConfig (Cookie 名の決定に使う)。env は isolate 内で変わらないので使い回す。 */
const configMemo = new WeakMap<Env, AppConfig>();

function configOf(env: Env): AppConfig {
  let config = configMemo.get(env);
  if (config === undefined) {
    config = loadWorkerConfig(env);
    configMemo.set(env, config);
  }
  return config;
}

/**
 * ログイン中ならキャッシュするページへのリクエストについて、セッションの Cookie キャッシュを
 * エッジで検証する。対象外のリクエストや、検証できなかった場合は undefined。
 */
async function verifySession(
  request: Request,
  env: Env,
  options: Required<GameStubOptions>,
  now: number,
): Promise<GatewaySession | undefined> {
  if (!needsSessionVerification(request)) {
    return undefined;
  }
  const resolved = await resolveAuthSecret(env, options, now);
  if (resolved === undefined) {
    return undefined;
  }
  const verified = await verifySessionCookieCache(request.headers, {
    secret: resolved.secret,
    config: configOf(env),
  });
  if (verified === undefined) {
    const { memo } = resolved;
    if (
      memo !== undefined &&
      now - memo.fetchedAt >= AUTH_SECRET_REFETCH_INTERVAL_MS &&
      authSecretMemo.get(options.doBinding) === memo
    ) {
      authSecretMemo.delete(options.doBinding);
    }
    return undefined;
  }
  return { sessionId: verified.sessionId, expiresAt: verified.expiresAt };
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
      const cachedPages = cachedPagesOf(ctx);
      if (cachedPages === undefined) {
        return toDirectResponse(await getGame(env, resolved).fetch(request));
      }
      const now = Date.now();
      const session = await verifySession(request, env, resolved, now);
      const plan = planGatewayRequest(request, { session, now });
      if (plan.kind === "cached") {
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
