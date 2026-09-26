// tmp/08-turn-trigger-admin-cli.md 「設定の読み込み (Node)」節 + tmp/14-users-auth.md
// 「環境変数」節の移植。Node 固有 (PORT、DB パス等) はここに含めない。それらは
// packages/node/src/config.ts が持つ。
import { defaultConfig } from "../core/config.ts";
import type { GameConfig } from "../core/config.ts";
import { defaultSiteSettings } from "../app/site-settings.ts";
import type { SiteSettings } from "../app/site-settings.ts";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  /**
   * 未設定なら better-auth がリクエストから baseURL/trustedOrigins を推定する
   * (bootstrap/auth.ts, web/middleware/csrf.tsx 参照)。カスタムドメインや逆プロキシ配下で
   * 明示したい場合だけ HAKONIWA_BASE_URL を設定する。
   */
  baseUrl?: string;
  /**
   * better-auth の secret と CSRF トークンの HMAC 鍵 (`HAKONIWA_AUTH_SECRET`)。任意。
   * 未設定なら buildDeps が初回起動時に生成して settings 表に保存したものを使う
   * (bootstrap/auth-secret.ts の resolveAuthSecret。解決済みの値は `BuiltDeps.authSecret`)。
   */
  secret?: string;
  x?: OAuthClientConfig;
  discord?: OAuthClientConfig;
  devLogin: boolean;
  /**
   * `HAKONIWA_ADMIN_EMAILS` 由来の管理者メール一覧 (小文字化はしない。isAdminEmail 側で比較時に
   * 小文字化する)。管理画面で追加した管理者 (settings 表) と合わせた判定は app/admin-policy.ts。
   */
  adminEmails: string[];
}

export interface MailConfig {
  /** 未設定なら ConsoleMailer (開発用) を使う。設定されていれば ResendMailer を使う。 */
  resendApiKey?: string;
  mailFrom: string;
}

export interface AppConfig {
  game: GameConfig;
  auth: AuthConfig;
  mail: MailConfig;
  adminEnabled: boolean;
  debug: boolean;
  /**
   * サイト設定 (app/site-settings.ts) のうち、settings 表に値が無い項目に使う値。
   * 非推奨の環境変数 (HAKONIWA_SITE_TITLE / HAKONIWA_ADMIN_NAME / HAKONIWA_EMAIL /
   * HAKONIWA_BBS_URL / HAKONIWA_TOPPAGE_URL / HAKONIWA_NG_WORDS / HAKONIWA_USE_LBBS /
   * HAKONIWA_TIMEZONE) があればその値、無ければ `defaultSiteSettings`。
   * 既存デプロイの互換のためだけに残している。新規には管理画面の「サイト設定」を使う。
   * 実行中の値は必ず `SiteSettingsService.get()` から読むこと (この値は起動時のまま変わらない)。
   */
  siteDefaults: SiteSettings;
}

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(
    `loadConfigFromEnv: ${name} must be "true" or "false" (got: ${JSON.stringify(raw)})`,
  );
}

function parseInteger(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`loadConfigFromEnv: ${name} must be an integer (got: ${JSON.stringify(raw)})`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `loadConfigFromEnv: ${name} is out of safe integer range (got: ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

function nonEmpty(raw: string | undefined): string | undefined {
  return raw === undefined || raw === "" ? undefined : raw;
}

function parseCsvList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function parseOAuthClientConfig(
  name: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
): OAuthClientConfig | undefined {
  const id = nonEmpty(clientId);
  const secret = nonEmpty(clientSecret);
  if (id === undefined && secret === undefined) {
    return undefined;
  }
  if (id === undefined || secret === undefined) {
    throw new Error(
      `loadConfigFromEnv: ${name}_CLIENT_ID and ${name}_CLIENT_SECRET must both be set`,
    );
  }
  return { clientId: id, clientSecret: secret };
}

/**
 * 非推奨の環境変数からサイト設定の既定値を組み立てる (settings 表に値が無い場合の互換用)。
 * Cloudflare の wrangler.jsonc vars は key を省略できず空文字列を置くことがあるため、
 * undefined だけでなく "" も「未設定」として既定値にフォールバックする。
 * @deprecated 環境変数ではなく管理画面の「サイト設定」を使う。
 */
function loadDeprecatedSiteDefaults(env: Record<string, string | undefined>): SiteSettings {
  const d = defaultSiteSettings;
  return {
    title: nonEmpty(env.HAKONIWA_SITE_TITLE) ?? d.title,
    adminName: nonEmpty(env.HAKONIWA_ADMIN_NAME) ?? d.adminName,
    email: nonEmpty(env.HAKONIWA_EMAIL) ?? d.email,
    bbsUrl: nonEmpty(env.HAKONIWA_BBS_URL) ?? d.bbsUrl,
    topPageUrl: nonEmpty(env.HAKONIWA_TOPPAGE_URL) ?? d.topPageUrl,
    ngWords: parseCsvList(env.HAKONIWA_NG_WORDS),
    useLbbs: parseBool("HAKONIWA_USE_LBBS", nonEmpty(env.HAKONIWA_USE_LBBS), d.useLbbs),
    timezone: nonEmpty(env.HAKONIWA_TIMEZONE) ?? d.timezone,
  };
}

function loadMailConfig(env: Record<string, string | undefined>): MailConfig {
  const resendApiKey = nonEmpty(env.HAKONIWA_RESEND_API_KEY);
  const mailFrom = env.HAKONIWA_MAIL_FROM ?? "hakoniwa@example.com";
  return { ...(resendApiKey !== undefined ? { resendApiKey } : {}), mailFrom };
}

function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const baseUrl = nonEmpty(env.HAKONIWA_BASE_URL);
  const secret = nonEmpty(env.HAKONIWA_AUTH_SECRET);
  const x = parseOAuthClientConfig(
    "HAKONIWA_X",
    env.HAKONIWA_X_CLIENT_ID,
    env.HAKONIWA_X_CLIENT_SECRET,
  );
  const discord = parseOAuthClientConfig(
    "HAKONIWA_DISCORD",
    env.HAKONIWA_DISCORD_CLIENT_ID,
    env.HAKONIWA_DISCORD_CLIENT_SECRET,
  );
  const devLogin = parseBool("HAKONIWA_DEV_LOGIN", env.HAKONIWA_DEV_LOGIN, false);
  const adminEmails = parseCsvList(env.HAKONIWA_ADMIN_EMAILS);

  return {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(secret !== undefined ? { secret } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(discord !== undefined ? { discord } : {}),
    devLogin,
    adminEmails,
  };
}

/**
 * 環境変数から `AppConfig` を組み立てる。不正な値 (真偽値/数値としてパースできない) は Error を throw する。
 *
 * 次の環境変数は廃止した (読まない): HAKONIWA_UNIT_TIME_SEC / HAKONIWA_START_AT /
 * HAKONIWA_FINAL_TURN。いずれも「新しいゲームを開始」フォームと CLI `game new` / `db init` の
 * 既定値にしか使われておらず、フォーム/CLI の引数で明示できるため。
 */
export function loadConfigFromEnv(env: Record<string, string | undefined>): AppConfig {
  const debug = parseBool("HAKONIWA_DEBUG", env.HAKONIWA_DEBUG, defaultConfig.debug);
  const adminEnabled = parseBool("HAKONIWA_ADMIN_ENABLED", env.HAKONIWA_ADMIN_ENABLED, true);
  const maxCatchUpTurns = parseInteger(
    "HAKONIWA_MAX_CATCH_UP_TURNS",
    env.HAKONIWA_MAX_CATCH_UP_TURNS,
    defaultConfig.maxCatchUpTurns,
  );
  if (maxCatchUpTurns <= 0) {
    throw new Error("loadConfigFromEnv: HAKONIWA_MAX_CATCH_UP_TURNS must be positive");
  }

  const game: GameConfig = {
    ...defaultConfig,
    debug,
    maxCatchUpTurns,
  };

  return {
    game,
    auth: loadAuthConfig(env),
    mail: loadMailConfig(env),
    adminEnabled,
    debug,
    siteDefaults: loadDeprecatedSiteDefaults(env),
  };
}
