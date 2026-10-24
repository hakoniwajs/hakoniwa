// Workers Cache (https://developers.cloudflare.com/workers/cache/) の使い方を決める純粋な関数群。
//
// 構成 (Issue #25):
//   default (Gateway, キャッシュ無効) → ctx.exports.CachedPages({ props }).fetch(req, { cf: { cacheKey } })
//     → CachedPages (WorkerEntrypoint, キャッシュ有効) → HakoniwaGame (DO)
//
// Workers Cache のキャッシュキーは「エントリポイント + パスとクエリ (cf.cacheKey で上書き可) +
// ctx.props + Worker のバージョン」で、Host・Cookie・Authorization は含まない。そのため Gateway は
// 「キャッシュキーに現れない入力で DO の応答が変わらない」ように、CachedPages へ渡すリクエストを
// ここで組み立て直す (URL は正規化し、ヘッダは必要なものだけ残す)。
// ここに置く関数は Request/Response 以外に依存しないので、単体テストで判定を確認できる。

/** キャッシュを有効にする内側のエントリポイントの名前 (wrangler.jsonc の `exports` のキー)。 */
export const CACHED_PAGES_ENTRYPOINT = "CachedPages";

/**
 * 未ログイン扱い (誰が見ても同じ応答) のページの props。`v` は props の形の版数で、
 * 形を変えるときは上げる (デプロイごとにキャッシュは分かれるが、念のため明示しておく)。
 */
export interface AnonymousPageProps {
  v: 1;
  viewer: "anonymous";
}

/** CachedPages に渡す `ctx.props`。キャッシュキーの一部になる。 */
export type CachedPagesProps = AnonymousPageProps;

/** Gateway がリクエストをどう扱うか。 */
export type GatewayPlan =
  /** DO へそのまま転送する (キャッシュを使わない)。 */
  | { kind: "direct" }
  /** CachedPages 経由にする。`url`/`headers` で DO へ渡すリクエストを組み立てる。 */
  | {
      kind: "cached";
      props: CachedPagesProps;
      /** `cf.cacheKey` に渡す値 (正規化したパスとクエリ)。 */
      cacheKey: string;
      /** CachedPages (と DO) に渡す URL。`cacheKey` と同じパス・クエリにしてある。 */
      url: string;
      method: "GET" | "HEAD";
      headers: Headers;
    };

/** `/games/:gameId/islands/:id/ogp.png`。 */
const OGP_PATH = /^\/games\/[0-9]+\/islands\/[0-9]+\/ogp\.png$/;

/** OGP 画像の URL の `?turn=N` (ターンごとに URL を変えて SNS 側のキャッシュを更新させる)。 */
const TURN_PARAM = /^[0-9]{1,10}$/;

/** 未ログイン扱いのリクエストで DO へ渡してよいヘッダ。Cookie と Authorization は渡さない。 */
const ANONYMOUS_FORWARDED_HEADERS = ["accept"] as const;

function pickHeaders(source: Headers, names: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * リクエストを CachedPages 経由にするかどうかと、そのときの props・キャッシュキーを決める。
 *
 * - GET/HEAD 以外、WebSocket の Upgrade は常に DO へ直接転送する。
 * - OGP 画像 (`/games/:gameId/islands/:id/ogp.png`) は誰が見ても同じ画像なので未ログイン扱いに
 *   する。クエリは `turn` (数字) だけを残し、Cookie などのヘッダは DO へ渡さない。
 */
export function planGatewayRequest(request: Request): GatewayPlan {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { kind: "direct" };
  }
  if (request.headers.get("upgrade") !== null) {
    return { kind: "direct" };
  }
  const url = new URL(request.url);
  if (OGP_PATH.test(url.pathname)) {
    const turn = url.searchParams.get("turn");
    const search = turn !== null && TURN_PARAM.test(turn) ? `?turn=${turn}` : "";
    const cacheKey = `${url.pathname}${search}`;
    return {
      kind: "cached",
      props: { v: 1, viewer: "anonymous" },
      cacheKey,
      url: `${url.origin}${cacheKey}`,
      method,
      headers: pickHeaders(request.headers, ANONYMOUS_FORWARDED_HEADERS),
    };
  }
  return { kind: "direct" };
}

/** ブラウザ向けの HTML 等に付ける `Cache-Control`。 */
export const BROWSER_NO_STORE = "private, no-store";

function withHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CachedPages の応答を、ブラウザへ返す形に書き換える (Gateway が使う)。
 *
 * CachedPages の応答はエッジのキャッシュ用に `public` になっていることがあるが、ブラウザや
 * 途中のプロキシには HTML をキャッシュさせたくない (ログイン前後で同じ URL の内容が変わるため)。
 * 画像 (`image/*`) 以外は `Cache-Control: private, no-store` に置き換える。`Cache-Tag` は
 * Cloudflare が取り除くはずだが、念のためここでも消す。
 */
export function toBrowserResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("cache-tag");
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    headers.set("cache-control", BROWSER_NO_STORE);
  }
  return withHeaders(response, headers);
}

/**
 * DO の応答を、Workers Cache に保存させる形に整える (CachedPages が使う)。
 *
 * `Set-Cookie` を含む応答は Workers Cache が自動でバイパスするが、ユーザー固有の Cookie が
 * 他人に配られることが無いよう、明示的に `private, no-store` にしてキャッシュさせない。
 * それ以外は DO が付けた `Cache-Control` / `Cache-Tag` をそのまま使う。
 */
export function toCacheableResponse(response: Response): Response {
  if (response.headers.get("set-cookie") === null) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", BROWSER_NO_STORE);
  headers.delete("cache-tag");
  return withHeaders(response, headers);
}
