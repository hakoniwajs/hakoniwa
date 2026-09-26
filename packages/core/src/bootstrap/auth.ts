// tmp/14-users-auth.md 「インスタンスの組み立て (bootstrap/auth.ts)」節の移植。
// 環境 (Node / Durable Objects) ごとに 1 インスタンスを作る。buildDeps の中で作り、
// BuiltDeps.auth として返す。
//
// - better-auth 1.7.5 の twitter/discord プロバイダは、プロフィールにメールが無い場合 (X 等)
//   自前で `<id>@<provider>.placeholder.invalid` 形式のプレースホルダメールを生成する
//   (`createPlaceholderEmail`。better-auth 本体の実装、anonymous プラグイン等と同じ仕組み)。
//   そのため `mapProfileToUser` によるプレースホルダ生成は指定しない (指定しても上書きされる
//   だけで、二重実装になる)。isAdminEmail は `.invalid` で終わるメールを常に除外するため、
//   このプレースホルダは管理者判定から除外される。
// - tmp/12-workers-adapter.md「Deploy to Cloudflare ボタン」節: HAKONIWA_BASE_URL は省略可能。
//   未設定なら baseURL を渡さず (リクエストから推定させる)、trustedOrigins はリクエストの
//   オリジンを返す関数にする。
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getCookies } from "better-auth/cookies";
import { magicLink } from "better-auth/plugins";
import type { AuthMethodPolicy } from "../app/auth-methods.ts";
import type { Mailer } from "../app/ports.ts";
import { betterAuthSqliteAdapter } from "../storage/better-auth-adapter.ts";
import type { SqlDriver } from "../storage/driver.ts";
import { authMethodOf } from "./auth-method-of.ts";
import { devLoginPlugin } from "./dev-login-plugin.ts";
import type { AppConfig } from "./config-from-env.ts";

/** マジックリンク・メール確認リンクの有効期限 (秒)。14「インスタンスの組み立て」節のコード例どおり。 */
const MAGIC_LINK_EXPIRES_IN_SECONDS = 600;

/** better-auth の Cookie 名の接頭辞。Cookie 名は `hako.session_token` などになる。 */
export const AUTH_COOKIE_PREFIX = "hako";

/**
 * セッションの Cookie キャッシュ (`session.cookieCache`。署名付き Cookie `hako.session_data` に
 * セッション情報を入れる) の有効期間 (秒)。この間、ログアウトや他の端末でのセッション削除は
 * Cookie キャッシュを使う経路 (Cloudflare 版のエッジでの検証と、DO の GET) に反映されない。
 */
export const SESSION_COOKIE_CACHE_MAX_AGE_SEC = 300;

/** Cookie 名の決定に関わる better-auth のオプション (createAuth と authCookieNames で共通)。 */
function cookieNamingOptions(config: AppConfig) {
  return {
    ...(config.auth.baseUrl !== undefined ? { baseURL: config.auth.baseUrl } : {}),
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
  };
}

/**
 * better-auth が使う Cookie の実際の名前 (`__Secure-` の有無を含む)。createAuth と同じ
 * オプションから better-auth 自身の `getCookies` で求めるので、better-auth の判定と一致する。
 */
export function authCookieNames(config: AppConfig): {
  sessionToken: string;
  sessionData: string;
} {
  const cookies = getCookies(cookieNamingOptions(config));
  return { sessionToken: cookies.sessionToken.name, sessionData: cookies.sessionData.name };
}

export interface CreateAuthInput {
  driver: SqlDriver;
  config: AppConfig;
  /**
   * 解決済みの auth secret (`HAKONIWA_AUTH_SECRET`、未設定なら settings 表に保存した自動生成値。
   * bootstrap/auth-secret.ts の resolveAuthSecret)。
   */
  secret: string;
  mailer: Mailer;
  authMethods: AuthMethodPolicy;
  /**
   * true ならセッションの Cookie キャッシュ (`session.cookieCache`、compact 形式) を有効にする。
   * Cloudflare 版がエッジ (Gateway) で DO に問い合わせずにセッションを検証するために使う。
   * 省略時は無効 (Node 版)。
   */
  sessionCookieCache?: boolean;
}

/** `AppConfig.auth` から better-auth インスタンスを組み立てる。 */
export function createAuth(input: CreateAuthInput) {
  const { driver, config, secret, mailer, authMethods } = input;
  const { auth } = config;
  const naming = cookieNamingOptions(config);

  return betterAuth({
    // baseUrl が未設定なら baseURL を渡さない (better-auth がリクエストから推定する)。
    // trustedOrigins も同様に、baseUrl があれば固定の配列、無ければリクエストのオリジンを
    // 返す関数にする (better-auth の trustedOrigins は関数形をサポートしている。
    // node_modules/@better-auth/core の型定義で確認済み)。
    ...(naming.baseURL !== undefined ? { baseURL: naming.baseURL } : {}),
    basePath: "/api/auth",
    secret,
    database: betterAuthSqliteAdapter({ driver }),
    trustedOrigins:
      auth.baseUrl !== undefined
        ? [auth.baseUrl]
        : (request) => (request !== undefined ? [new URL(request.url).origin] : []),
    advanced: {
      // Cookie 名は `hako.session_token` になる。
      cookiePrefix: naming.advanced.cookiePrefix,
    },
    ...(input.sessionCookieCache === true
      ? {
          session: {
            cookieCache: {
              enabled: true,
              maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SEC,
              // 署名 (HMAC-SHA256) 付きの JSON。bootstrap/session-cookie-cache.ts が
              // better-auth の getCookieCache で検証する。
              strategy: "compact" as const,
            },
          },
        }
      : {}),
    socialProviders: {
      ...(auth.x !== undefined
        ? { twitter: { clientId: auth.x.clientId, clientSecret: auth.x.clientSecret } }
        : {}),
      ...(auth.discord !== undefined
        ? { discord: { clientId: auth.discord.clientId, clientSecret: auth.discord.clientSecret } }
        : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        // X (プレースホルダ email) のユーザーに Discord/メールを紐付けるため。
        allowDifferentEmails: true,
        // 連携時に name/image を取り込む (email/emailVerified は変わらない)。
        updateUserInfoOnLink: true,
        // 最後の 1 つは解除できない。
        allowUnlinkingAll: false,
      },
    },
    // メールの設定/変更 (新しいメールに確認リンクを送る)。X ユーザーが後からメールを設定する導線。
    user: { changeEmail: { enabled: true } },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: "【箱庭諸島】メールアドレスの確認",
          text: url,
        });
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({ to: email, subject: "【箱庭諸島】ログイン用リンク", text: url });
        },
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      }),
      ...(auth.devLogin ? [devLoginPlugin()] : []),
    ],
    hooks: {
      // 管理画面で無効化されたログイン方法を、better-auth のエンドポイント側でも拒否する。
      before: createAuthMiddleware(async (ctx) => {
        const method = authMethodOf({ path: ctx.path, params: ctx.params, body: ctx.body });
        if (method !== undefined && !authMethods.enabled()[method]) {
          throw new APIError("FORBIDDEN", { message: "このログイン方法は現在無効です。" });
        }
      }),
    },
  });
}
