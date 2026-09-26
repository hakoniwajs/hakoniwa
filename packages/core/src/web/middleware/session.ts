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
}

export function sessionMiddleware(deps: SessionMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (session !== null) {
      c.set("user", toAuthUser(session.user, deps.adminPolicy.adminEmails()));
      c.set("sessionId", session.session.id);
    }
    await next();
  };
}
