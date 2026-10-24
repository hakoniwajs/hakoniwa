// セッションの Cookie キャッシュ (better-auth の `session.cookieCache`、署名付き Cookie
// `hako.session_data`) を、better-auth のインスタンス (DB) を使わずに検証する。
// Cloudflare 版の Gateway が、DO に問い合わせずにログイン中のユーザーのセッション ID を
// 確かめるために使う (Issue #25)。
//
// 検証 (HMAC-SHA256 の署名・Cookie キャッシュの有効期限・セッション自体の有効期限) は
// better-auth 自身の `getCookieCache` に任せ、ここでは Cookie の取り出しと、セッショントークン
// の Cookie (`hako.session_token`) との対応の確認だけを行う。どれか 1 つでも満たさなければ
// `undefined` を返す (呼び出し側はキャッシュを使わずに DO へ転送する)。
import { getCookieCache, parseCookies } from "better-auth/cookies";
import { AUTH_COOKIE_PREFIX, authCookieNames } from "./auth.ts";
import type { AppConfig } from "./config-from-env.ts";

/** 検証できたセッションの Cookie キャッシュ。 */
export interface VerifiedSessionCookie {
  /** better-auth の session.id (CSRF トークンの HMAC の入力)。 */
  sessionId: string;
  userId: string;
  /** Cookie キャッシュの有効期限 (unix ミリ秒)。 */
  expiresAt: number;
}

export interface VerifySessionCookieCacheInput {
  /** 解決済みの auth secret (better-auth の secret)。 */
  secret: string;
  config: AppConfig;
}

/** better-auth と同じく、`name` そのもの、または `name.0`・`name.1`… に分割された Cookie を連結する。 */
function readChunkedCookie(cookies: Map<string, string>, name: string): string | undefined {
  const whole = cookies.get(name);
  if (whole !== undefined && whole !== "") {
    return whole;
  }
  const chunks: { index: number; value: string }[] = [];
  for (const [key, value] of cookies) {
    if (!key.startsWith(`${name}.`)) {
      continue;
    }
    const indexText = key.slice(name.length + 1);
    if (!/^[0-9]+$/.test(indexText)) {
      continue;
    }
    chunks.push({ index: Number(indexText), value });
  }
  if (chunks.length === 0) {
    return undefined;
  }
  chunks.sort((a, b) => a.index - b.index);
  return chunks.map((chunk) => chunk.value).join("");
}

/** base64url (パディング無し) を UTF-8 の文字列に戻す。 */
function decodeBase64Url(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return undefined;
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * compact 形式の Cookie キャッシュ (`base64url(JSON({ session, expiresAt, signature }))`) から
 * `expiresAt` を読む。署名の検証は getCookieCache が同じ文字列に対して行う。
 */
function readExpiresAt(raw: string): number | undefined {
  const json = decodeBase64Url(raw);
  if (json === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * リクエストの Cookie から、セッションの Cookie キャッシュを検証する。
 *
 * 1. `hako.session_data` (分割されていれば連結) を better-auth の getCookieCache で検証する
 *    (署名・有効期限)。
 * 2. Cookie キャッシュの中のセッショントークンが、`hako.session_token` (署名付き Cookie の
 *    `<token>.<署名>` の token 部分) と一致することを確かめる。一致しなければ、DO 側の
 *    better-auth は Cookie キャッシュを使わずに DB を引くため、エッジと DO で別のセッションに
 *    なりうる。
 */
export async function verifySessionCookieCache(
  headers: Headers,
  input: VerifySessionCookieCacheInput,
): Promise<VerifiedSessionCookie | undefined> {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null || cookieHeader === "") {
    return undefined;
  }
  const names = authCookieNames(input.config);
  const cookies = parseCookies(cookieHeader);

  const signedToken = cookies.get(names.sessionToken);
  if (signedToken === undefined) {
    return undefined;
  }
  const signatureStart = signedToken.lastIndexOf(".");
  if (signatureStart < 1) {
    return undefined;
  }
  const token = signedToken.slice(0, signatureStart);

  const raw = readChunkedCookie(cookies, names.sessionData);
  if (raw === undefined) {
    return undefined;
  }
  const expiresAt = readExpiresAt(raw);
  if (expiresAt === undefined) {
    return undefined;
  }

  // 連結した値をそのまま 1 つの Cookie として渡し、上で expiresAt を読んだ文字列と同じものを
  // better-auth に検証させる。
  let payload: Awaited<ReturnType<typeof getCookieCache>>;
  try {
    payload = await getCookieCache(new Headers({ cookie: `${names.sessionData}=${raw}` }), {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      cookieName: "session_data",
      isSecure: names.sessionData.startsWith("__Secure-"),
      secret: input.secret,
      strategy: "compact",
    });
  } catch {
    return undefined;
  }
  if (payload === null) {
    return undefined;
  }
  const session = payload.session;
  if (typeof session.id !== "string" || session.id === "" || session.token !== token) {
    return undefined;
  }
  return { sessionId: session.id, userId: session.userId, expiresAt };
}
