// tmp/14-users-auth.md 「複数ログイン方法の紐付け (アカウント設定 /account)」節の移植。
import { Hono } from "hono";
import type { Context } from "hono";
import { APIError } from "better-auth/api";
import { AppError } from "../../app/errors.ts";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { parseStringBody } from "../forms/common.ts";
import { parseEmailForm, parseNameForm, parseUnlinkForm } from "../forms/account-forms.ts";
import { renderPage } from "./render.tsx";
import { AccountPage } from "../views/account.tsx";
import { ErrorPage } from "../views/messages.tsx";

const PROVIDER_MAP = { x: "twitter", discord: "discord" } as const;

function forwardSetCookie(c: Context<AppEnv>, headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }
}

function renderAuthApiError(c: Context<AppEnv>, deps: WebDeps, err: unknown) {
  if (err instanceof APIError) {
    deps.logger.error("better-auth API error", err);
    const status = err.statusCode === 403 ? 403 : 400;
    const body = err.body as { message?: unknown } | undefined;
    const message =
      typeof body?.message === "string" ? body.message : "リクエストを処理できませんでした。";
    return renderPage(c, deps, <ErrorPage message={message} />, status);
  }
  throw err;
}

/** アカウント設定画面を最新のセッション情報で再構成する。ログイン必須。 */
async function renderAccountPage(c: Context<AppEnv>, deps: WebDeps, notice?: string) {
  // セッションの Cookie キャッシュ (Cloudflare 版) を使うと、直前に変更した表示名などが
  // 反映されないため、常に DB のセッションを読む。
  const session = await deps.auth.api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  });
  if (session === null) {
    throw new AppError("login_required");
  }
  const accounts = await deps.auth.api.listUserAccounts({ headers: c.req.raw.headers });
  const methods = deps.adminService.getAuthMethods();
  return renderPage(
    c,
    deps,
    <AccountPage
      email={session.user.email}
      name={session.user.name}
      accounts={accounts}
      methods={methods}
      csrfToken={c.get("csrfToken") ?? ""}
      notice={notice}
    />,
  );
}

export function createAccountRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/account", async (c) => {
    if (c.get("user") === undefined) {
      throw new AppError("login_required");
    }
    return renderAccountPage(c, deps);
  });

  app.post("/account/link/:provider{x|discord}", async (c) => {
    if (c.get("user") === undefined) {
      throw new AppError("login_required");
    }
    const provider = c.req.param("provider") as keyof typeof PROVIDER_MAP;
    const methods = deps.adminService.getAuthMethods();
    if (!methods.enabled[provider]) {
      return c.notFound();
    }
    try {
      const { headers, response } = await deps.auth.api.linkSocialAccount({
        body: { provider: PROVIDER_MAP[provider], callbackURL: "/account" },
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      forwardSetCookie(c, headers);
      if (response.url === undefined) {
        throw new Error("linkSocialAccount: response.url is missing");
      }
      return c.redirect(response.url, 302);
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
  });

  app.post("/account/unlink", async (c) => {
    if (c.get("user") === undefined) {
      throw new AppError("login_required");
    }
    const body = await parseStringBody(c);
    const { accountId } = parseUnlinkForm(body);
    try {
      await deps.auth.api.unlinkAccount({
        body: { accountId },
        headers: c.req.raw.headers,
      });
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return renderAccountPage(c, deps, "連携を解除しました。");
  });

  app.post("/account/email", async (c) => {
    if (c.get("user") === undefined) {
      throw new AppError("login_required");
    }
    const body = await parseStringBody(c);
    const { email } = parseEmailForm(body);
    try {
      await deps.auth.api.changeEmail({
        body: { newEmail: email, callbackURL: "/account" },
        headers: c.req.raw.headers,
      });
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return renderAccountPage(c, deps, "確認メールを送りました。届いたリンクを開いてください。");
  });

  app.post("/account/name", async (c) => {
    if (c.get("user") === undefined) {
      throw new AppError("login_required");
    }
    const body = await parseStringBody(c);
    const { name } = parseNameForm(body);
    try {
      const { headers } = await deps.auth.api.updateUser({
        body: { name },
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      // セッションの Cookie キャッシュ (Cloudflare 版) には表示名も入っているので、better-auth が
      // 作り直した Cookie をブラウザへ返す (返さないと、Cookie キャッシュの期限まで古い表示名の
      // ままになる)。Cookie キャッシュを使わない場合 (Node 版) は従来どおり返さない。
      if (deps.sessionCookieCache === true) {
        forwardSetCookie(c, headers);
      }
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return renderAccountPage(c, deps, "表示名を変更しました。");
  });

  return app;
}
