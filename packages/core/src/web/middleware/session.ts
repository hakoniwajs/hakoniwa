// tmp/14-users-auth.md 「サーバーサイドでの呼び出し」節: 毎リクエスト auth.api.getSession を呼び、
// c.set('user', ...) / c.set('sessionId', ...) する。未ログインはどちらも未設定のまま。
import type { MiddlewareHandler } from "hono";
import type { AdminPolicy } from "../../app/admin-policy.ts";
import { toAuthUser } from "../../app/auth.ts";
import type { AppEnv } from "../env.ts";
import type { WebDeps } from "../deps.ts";

export interface SessionMiddlewareDeps {
  auth: WebDeps["auth"];
  /** 管理者判定 (HAKONIWA_ADMIN_EMAILS + 管理画面で追加した管理者)。 */
  adminPolicy: AdminPolicy;
  /**
   * better-auth のセッションの Cookie キャッシュ (`session.cookieCache`) を有効にしているか
   * (`WebDeps.sessionCookieCache`)。省略時は false。
   */
  sessionCookieCache?: boolean;
}

/**
 * Cookie キャッシュを使わず、必ず DB のセッションを確かめるパス (管理画面・アカウント設定)。
 * ログアウトや他の端末でのセッション削除を、Cookie キャッシュの有効期間を待たずに反映させる。
 */
const AUTHORITATIVE_SESSION_PATHS = [/^\/admin(?:\/|$)/, /^\/account(?:\/|$)/] as const;

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export function sessionMiddleware(deps: SessionMiddlewareDeps): MiddlewareHandler<AppEnv> {
  if (deps.sessionCookieCache !== true) {
    return async (c, next) => {
      const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
      if (session !== null) {
        c.set("user", toAuthUser(session.user, deps.adminPolicy.adminEmails()));
        c.set("sessionId", session.session.id);
      }
      await next();
    };
  }

  // Cookie キャッシュを有効にしている場合 (Cloudflare 版):
  // - GET/HEAD は Cookie キャッシュを使う (エッジの Gateway が同じ Cookie で検証したセッションと
  //   一致させるため)。ただし管理画面・アカウント設定と、状態を変える POST などは DB を引く。
  // - better-auth が Cookie キャッシュを作り直したとき (期限切れ後に DB を引いたとき等) の
  //   Set-Cookie を GET/HEAD の応答に付けて、ブラウザの Cookie キャッシュを更新する。POST などの
  //   応答には付けない (ログアウトの応答で、削除した Cookie を付け直してしまわないように)。
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const useCookieCache =
      isReadMethod(method) && !AUTHORITATIVE_SESSION_PATHS.some((re) => re.test(c.req.path));
    const { headers, response: session } = await deps.auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: !useCookieCache },
      returnHeaders: true,
    });
    if (session !== null) {
      c.set("user", toAuthUser(session.user, deps.adminPolicy.adminEmails()));
      c.set("sessionId", session.session.id);
    }
    await next();
    if (isReadMethod(method)) {
      for (const cookie of headers.getSetCookie()) {
        c.res.headers.append("set-cookie", cookie);
      }
    }
  };
}
