// better-auth の secret と CSRF トークンの HMAC 鍵 (auth secret) の解決。
// Deploy to Cloudflare でデプロイ時に何も入力しなくて済むよう、`HAKONIWA_AUTH_SECRET` を
// 任意にした。未設定なら初回起動時に強いランダム値を生成して settings 表に保存し、以後は
// それを使い続ける。環境変数が設定されていれば常にそちらを優先する (後方互換)。
//
// 注意: settings 表は migrate() で作られるため、呼び出し側 (buildDeps) は migrate 済みの
// driver から作った SettingsRepository を渡すこと (Node の compose.ts、Workers の
// game-object.ts はどちらも buildDeps より前に migrate を呼んでいる)。
import type { SettingsRepository } from "../app/ports.ts";

/** settings 表のキー。値は base64 文字列 (32 バイトの乱数)。 */
export const AUTH_SECRET_SETTINGS_KEY = "auth.secret";

/** 自動生成する secret のバイト数。better-auth は 32 文字以上を推奨している。 */
const GENERATED_SECRET_BYTES = 32;

function generateSecret(): string {
  const bytes = new Uint8Array(GENERATED_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * auth secret を決める。
 * 1. `envSecret` (`HAKONIWA_AUTH_SECRET`) があればそれ。
 * 2. 無ければ settings 表の `auth.secret`。
 * 3. それも無ければ新しく生成して settings 表に保存したもの。
 */
export function resolveAuthSecret(
  envSecret: string | undefined,
  settings: SettingsRepository,
): string {
  if (envSecret !== undefined && envSecret !== "") {
    return envSecret;
  }
  const stored = settings.get(AUTH_SECRET_SETTINGS_KEY);
  if (stored !== undefined && stored !== "") {
    return stored;
  }
  const generated = generateSecret();
  settings.set(AUTH_SECRET_SETTINGS_KEY, generated);
  return generated;
}
