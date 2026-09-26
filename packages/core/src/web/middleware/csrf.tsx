// tmp/14-users-auth.md 「Cookie と CSRF」節、tmp/07-auth-and-security.md 「CSRF」節の移植。
// 状態変更 POST (自前ルート全部。/auth/dev, /auth/magic-link は _csrf を除外) で
// `_csrf` を verifyCsrfToken で照合する。/api/auth/* は createApp の中で最初にマウントされ、
// このミドルウェアより前で処理が終わるため、ここでは対象にならない
// (better-auth 自身は trustedOrigins で Origin を検証する)。
// 加えて Origin ヘッダがあれば HAKONIWA_BASE_URL のオリジンと比較する (除外ルートも含む)。
// 設計書との差異: HAKONIWA_BASE_URL 省略可能化 (tmp/12「Deploy to Cloudflare ボタン」節) に伴い、
// baseUrl が未設定の場合はリクエスト URL のオリジン (`new URL(c.req.url).origin`) と比較する。
import type { Context, MiddlewareHandler } from "hono";
import { createCsrfToken, verifyCsrfToken } from "../../bootstrap/csrf.ts";
import type { SiteSettingsReader } from "../../app/site-settings.ts";
import type { AppEnv } from "../env.ts";
import { Layout } from "../views/layout.tsx";
import { ErrorPage } from "../views/messages.tsx";

export interface CsrfMiddlewareDeps {
  secret: string;
  /** 未設定ならリクエスト URL のオリジンと比較する (HAKONIWA_BASE_URL 省略可能化)。 */
  baseUrl?: string;
  /** 403 画面の Layout (タイトル・フッタ) 用。 */
  siteSettings: SiteSettingsReader;
}

/** `_csrf` を要求しない自前ルート (セッション確立前の POST)。 */
const NO_CSRF_PATHS = new Set(["/auth/dev", "/auth/magic-link"]);

function originMismatch(originHeader: string | undefined, expectedHost: string): boolean {
  if (originHeader === undefined || originHeader === "") {
    return false;
  }
  try {
    const originHost = new URL(originHeader).host;
    return originHost !== expectedHost;
  } catch {
    return true;
  }
}

function forbidden(c: Context<AppEnv>, deps: CsrfMiddlewareDeps) {
  return c.html(
    <Layout site={deps.siteSettings.get()} user={c.get("user")} csrfToken={c.get("csrfToken")}>
      <ErrorPage message="不正なリクエストです。" />
    </Layout>,
    403,
  );
}

export function csrfMiddleware(deps: CsrfMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sessionId = c.get("sessionId");
    // ログイン中のみ csrfToken を用意する (views の hidden _csrf 用)。
    if (sessionId !== undefined) {
      c.set("csrfToken", await createCsrfToken(deps.secret, sessionId));
    }

    if (c.req.method === "POST") {
      const expectedHost =
        deps.baseUrl !== undefined ? new URL(deps.baseUrl).host : new URL(c.req.url).host;
      if (originMismatch(c.req.header("origin"), expectedHost)) {
        return forbidden(c, deps);
      }
      // 未ログインの POST は _csrf を検査しない (ログインが必要な操作は各ユースケースが
      // login_required で拒否する。ログイン前提の /auth/dev, /auth/magic-link も対象外)。
      if (sessionId !== undefined && !NO_CSRF_PATHS.has(c.req.path)) {
        const body = await c.req.parseBody();
        const raw = body["_csrf"];
        const token = typeof raw === "string" ? raw : "";
        const valid = await verifyCsrfToken(deps.secret, sessionId, token);
        if (!valid) {
          return forbidden(c, deps);
        }
      }
    }

    await next();
  };
}
