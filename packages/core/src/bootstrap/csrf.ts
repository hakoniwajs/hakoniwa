// tmp/14-users-auth.md 「Cookie と CSRF」節の移植。
// ステートレスな CSRF トークン: `base64url(HMAC-SHA256(secret, sessionId))`。
// 追加のテーブルを持たず、csrf-middleware (Phase 6b) が再計算して照合する。
// Web Crypto (`crypto.subtle`) のみに依存し、node:* を import しない。
import { safeEqual } from "../app/constant-time.ts";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

/**
 * auth secret (`HAKONIWA_AUTH_SECRET`、未設定なら bootstrap/auth-secret.ts が自動生成した値) と
 * セッション ID から CSRF トークンを作る。
 */
export async function createCsrfToken(secret: string, sessionId: string): Promise<string> {
  return toBase64Url(await hmacSha256(secret, sessionId));
}

/** 送られてきたトークンを再計算し、定数時間比較で照合する。 */
export async function verifyCsrfToken(
  secret: string,
  sessionId: string,
  token: string,
): Promise<boolean> {
  if (token === "") {
    return false;
  }
  const expected = await createCsrfToken(secret, sessionId);
  return safeEqual(token, expected);
}
