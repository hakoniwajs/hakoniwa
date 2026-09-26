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
import { CACHE_HINT_HEADER, CACHE_TAG_HINT_HEADER } from "@hakoniwajs/core";

/** キャッシュを有効にする内側のエントリポイントの名前 (wrangler.jsonc の `exports` のキー)。 */
export const CACHED_PAGES_ENTRYPOINT = "CachedPages";

/**
 * 未ログイン扱い (誰が見ても同じ応答) のページの props。`v` は props の形の版数で、
 * 形を変えるときは上げる (デプロイごとにキャッシュは分かれるが、念のため明示しておく)。
 * `origin` は HTML の場合だけ入れる。OGP メタタグの絶対 URL にリクエストのオリジンを使う
 * (`HAKONIWA_BASE_URL` 未設定時) ため、Host がキャッシュキーに含まれないことを補う。
 */
export interface AnonymousPageProps {
  v: 1;
  viewer: "anonymous";
  origin?: string;
}

/**
 * ログイン中のページの props。セッションごとにキャッシュを分ける。
 * - `sessionId`: Gateway がセッションの Cookie キャッシュ (署名付き) で検証したセッション ID。
 *   ページに埋め込む CSRF トークンが HMAC(secret, sessionId) なので、ユーザー単位ではなく
 *   セッション単位で分ける必要がある。
 * - `rev`: Cookie `hako_rev` の値。DO が状態を変えるリクエスト (POST など) のたびに新しい値を
 *   Set-Cookie するので、自分の操作の直後の GET は必ず新しいキャッシュキーになる。利用者が
 *   書き換えても、自分のセッションのキャッシュが外れるだけ (他人の応答は `sessionId` が違うため
 *   取得できない)。
 * - `origin`: 未ログインの場合と同じ。
 */
export interface SessionPageProps {
  v: 1;
  viewer: "session";
  sessionId: string;
  rev: string;
  origin: string;
}

/** CachedPages に渡す `ctx.props`。キャッシュキーの一部になる。 */
export type CachedPagesProps = AnonymousPageProps | SessionPageProps;

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

/**
 * キャッシュする HTML のページ: `/games` (ゲーム一覧)、`/games/:gameId` (トップ)、
 * `/games/:gameId/islands/:id` (観光)。
 */
const PAGE_PATHS = [
  /^\/games$/,
  /^\/games\/[0-9]+$/,
  /^\/games\/[0-9]+\/islands\/[0-9]+$/,
] as const;

/**
 * ログイン中ならキャッシュするページ: `PAGE_PATHS` と `/games/:gameId/my-island` (開発画面)。
 * 管理画面 (`/admin*`)・アカウント設定 (`/account*`)・ログイン (`/login`, `/auth/*`,
 * `/api/auth/*`) はここに含めず、常に DO へ直接転送する。
 */
const SESSION_PAGE_PATHS = [...PAGE_PATHS, /^\/games\/[0-9]+\/my-island$/] as const;

/** `/games/:gameId` (トップ)。`?notice=no_island` (島を持たずに開発画面を開いたときの通知) を残す。 */
const TOP_PATH = /^\/games\/[0-9]+$/;

/**
 * Cookie `hako_rev` (DO が状態を変えるリクエストのたびに付け替える世代番号)。
 * ドットを含まない名前にして、better-auth の Cookie (`hako.`) と区別する。
 */
export const REV_COOKIE = "hako_rev";

/** `hako_rev` の値として受け付ける形 (DO は Date.now() 由来の 36 進数を付ける)。 */
const REV_VALUE = /^[0-9a-z]{1,16}$/;

/**
 * セッションの Cookie キャッシュの有効期限まで、これより短ければキャッシュを使わずに DO へ
 * 転送する (DO 側で期限切れと判定されて Cookie が作り直される場合に備えた余裕)。
 */
export const SESSION_EXPIRY_MARGIN_MS = 10_000;

/**
 * better-auth の Cookie (`cookiePrefix` は `hako`。`hako.session_token` / `hako.session_data`
 * など。HTTPS では `__Secure-` が付く) の名前。
 */
const AUTH_COOKIE_NAME = /^(?:__Secure-|__Host-)?hako\./;

/** OGP 画像の URL の `?turn=N` (ターンごとに URL を変えて SNS 側のキャッシュを更新させる)。 */
const TURN_PARAM = /^[0-9]{1,10}$/;

/** 未ログイン扱いのリクエストで DO へ渡してよいヘッダ。Cookie と Authorization は渡さない。 */
const ANONYMOUS_FORWARDED_HEADERS = ["accept"] as const;

/**
 * Cookie ヘッダを `name=value` の組に分ける (値はデコードしない)。
 */
function cookiePairs(cookieHeader: string | null): { name: string; pair: string; value: string }[] {
  if (cookieHeader === null) {
    return [];
  }
  const pairs: { name: string; pair: string; value: string }[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    const name = (index === -1 ? trimmed : trimmed.slice(0, index)).trim();
    if (name === "") {
      continue;
    }
    pairs.push({ name, pair: trimmed, value: index === -1 ? "" : trimmed.slice(index + 1).trim() });
  }
  return pairs;
}

/** Cookie ヘッダの各 Cookie の名前を取り出す。 */
export function cookieNames(cookieHeader: string | null): string[] {
  return cookiePairs(cookieHeader).map((pair) => pair.name);
}

/** Cookie `hako_rev` の値。無い・形が違う場合は空文字列。 */
export function revOf(request: Request): string {
  const found = cookiePairs(request.headers.get("cookie")).find((pair) => pair.name === REV_COOKIE);
  return found !== undefined && REV_VALUE.test(found.value) ? found.value : "";
}

/** DO が状態を変えるリクエストの応答に付ける `Set-Cookie: hako_rev=...`。 */
export function revSetCookie(rev: string, secure: boolean): string {
  return `${REV_COOKIE}=${rev}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** better-auth の Cookie だけを残した Cookie ヘッダ (ログイン中のページを DO に描画させるため)。 */
function authCookieHeader(request: Request): string {
  return cookiePairs(request.headers.get("cookie"))
    .filter((pair) => AUTH_COOKIE_NAME.test(pair.name))
    .map((pair) => pair.pair)
    .join("; ");
}

/** ログイン中の可能性がある (better-auth の Cookie を 1 つでも持つ) か。 */
export function hasAuthCookie(request: Request): boolean {
  return cookieNames(request.headers.get("cookie")).some((name) => AUTH_COOKIE_NAME.test(name));
}

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
 * Gateway がセッションの Cookie キャッシュを検証すべきリクエストか (ログイン中なら
 * キャッシュするページへの GET/HEAD で、better-auth の Cookie を持つ)。検証には auth secret が
 * 要るので、必要なときだけ行う。
 */
export function needsSessionVerification(request: Request): boolean {
  const method = request.method.toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || request.headers.get("upgrade") !== null) {
    return false;
  }
  const { pathname } = new URL(request.url);
  return SESSION_PAGE_PATHS.some((pattern) => pattern.test(pathname)) && hasAuthCookie(request);
}

/** Gateway がエッジで検証したセッション (`@hakoniwajs/core` の verifySessionCookieCache の結果)。 */
export interface GatewaySession {
  sessionId: string;
  /** Cookie キャッシュの有効期限 (unix ミリ秒)。 */
  expiresAt: number;
}

export interface PlanGatewayOptions {
  /** 検証できたセッション。検証していない・できなかった場合は undefined。 */
  session?: GatewaySession | undefined;
  /** 現在時刻 (unix ミリ秒)。 */
  now: number;
}

/**
 * リクエストを CachedPages 経由にするかどうかと、そのときの props・キャッシュキーを決める。
 *
 * - GET/HEAD 以外、WebSocket の Upgrade は常に DO へ直接転送する。
 * - OGP 画像 (`/games/:gameId/islands/:id/ogp.png`) は誰が見ても同じ画像なので未ログイン扱いに
 *   する。クエリは `turn` (数字) だけを残し、Cookie などのヘッダは DO へ渡さない。
 * - HTML のページ (`PAGE_PATHS`) は、better-auth の Cookie を持たないリクエストだけを未ログイン
 *   扱いにする (Cookie を持つリクエストは、ログイン中のページを誤って未ログインのキャッシュから
 *   返さないよう DO へ直接転送する)。クエリはすべて落とし、Cookie などのヘッダは DO へ渡さない
 *   (DO は必ず未ログインとして描画する)。
 * - better-auth の Cookie を持つリクエストは、ログイン中ならキャッシュするページ
 *   (`SESSION_PAGE_PATHS`) で、Gateway がセッションを検証でき (`options.session`)、その
 *   有効期限まで余裕がある場合だけ、セッションごとの props で CachedPages 経由にする。
 *   クエリはトップの `notice=no_island` だけを残し、DO には better-auth の Cookie だけを渡す。
 *   検証できなければ DO へ直接転送する。
 */
export function planGatewayRequest(
  request: Request,
  options: PlanGatewayOptions = { now: Date.now() },
): GatewayPlan {
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
  if (!hasAuthCookie(request)) {
    if (!PAGE_PATHS.some((pattern) => pattern.test(url.pathname))) {
      return { kind: "direct" };
    }
    const cacheKey = url.pathname;
    return {
      kind: "cached",
      props: { v: 1, viewer: "anonymous", origin: url.origin },
      cacheKey,
      url: `${url.origin}${cacheKey}`,
      method,
      headers: pickHeaders(request.headers, ANONYMOUS_FORWARDED_HEADERS),
    };
  }
  const { session, now } = options;
  if (
    session === undefined ||
    session.sessionId === "" ||
    session.expiresAt - now < SESSION_EXPIRY_MARGIN_MS ||
    !SESSION_PAGE_PATHS.some((pattern) => pattern.test(url.pathname))
  ) {
    return { kind: "direct" };
  }
  const search =
    TOP_PATH.test(url.pathname) && url.searchParams.get("notice") === "no_island"
      ? "?notice=no_island"
      : "";
  const cacheKey = `${url.pathname}${search}`;
  const headers = pickHeaders(request.headers, ANONYMOUS_FORWARDED_HEADERS);
  headers.set("cookie", authCookieHeader(request));
  return {
    kind: "cached",
    props: {
      v: 1,
      viewer: "session",
      sessionId: session.sessionId,
      rev: revOf(request),
      origin: url.origin,
    },
    cacheKey,
    url: `${url.origin}${cacheKey}`,
    method,
    headers,
  };
}

/**
 * Gateway がどちらの経路で応答したか (`cached`: CachedPages 経由、`direct`: DO へ直接転送)。
 * 動作確認用。CachedPages 経由でも、実際にキャッシュから返ったかどうかは Workers Cache 次第。
 */
export const ROUTE_HEADER = "X-Hakoniwa-Route";

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
  deleteHintHeaders(headers);
  headers.delete("cache-tag");
  headers.set(ROUTE_HEADER, "cached");
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    headers.set("cache-control", BROWSER_NO_STORE);
  }
  return withHeaders(response, headers);
}

/** DO が付ける内部ヘッダ (キャッシュの目安) を消す。 */
function deleteHintHeaders(headers: Headers): void {
  headers.delete(CACHE_HINT_HEADER);
  headers.delete(CACHE_TAG_HINT_HEADER);
}

/**
 * DO の応答を、Workers Cache に保存させる形に整える (CachedPages が使う)。
 *
 * - `Set-Cookie` を含む応答は Workers Cache が自動でバイパスするが、ユーザー固有の Cookie が
 *   他人に配られることが無いよう、明示的に `private, no-store` にしてキャッシュさせない。
 * - 200 の応答に DO がキャッシュの目安 (`X-Hakoniwa-Cache-Control` / `X-Hakoniwa-Cache-Tag`。
 *   `@hakoniwajs/core` の web/cache-hint.ts) を付けていれば、`Cache-Control: public, <目安>` と
 *   `Cache-Tag` に変換する。
 * - それ以外は DO が付けた `Cache-Control` (OGP 画像の `public, ...` や既定の `private, no-store`)
 *   をそのまま使う。
 */
export function toCacheableResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const hint = headers.get(CACHE_HINT_HEADER);
  const tags = headers.get(CACHE_TAG_HINT_HEADER);
  deleteHintHeaders(headers);
  if (headers.get("set-cookie") !== null) {
    headers.set("cache-control", BROWSER_NO_STORE);
    headers.delete("cache-tag");
  } else if (hint !== null && response.status === 200) {
    headers.set("cache-control", `public, ${hint}`);
    if (tags !== null && tags !== "") {
      headers.set("cache-tag", tags);
    }
  }
  return withHeaders(response, headers);
}

/** DO へ直接転送した応答から、内部ヘッダを消す (Gateway が使う)。 */
export function toDirectResponse(response: Response): Response {
  // WebSocket の Upgrade (101) 等は Response を作り直せないのでそのまま返す。
  if (response.status < 200) {
    return response;
  }
  const headers = new Headers(response.headers);
  deleteHintHeaders(headers);
  headers.set(ROUTE_HEADER, "direct");
  return withHeaders(response, headers);
}
