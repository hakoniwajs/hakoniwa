// tmp/14-users-auth.md 「サーバーサイドでの呼び出し (web 層)」節、「ルート」節の移植。
// /login, /auth/:provider, /auth/magic-link, /auth/dev, /logout。
import { Hono } from "hono";
import type { Context } from "hono";
import { APIError } from "better-auth/api";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { parseStringBody } from "../forms/common.ts";
import { parseDevLoginForm, parseMagicLinkForm } from "../forms/auth-forms.ts";
import { betterAuthServerCall } from "../better-auth-request.ts";
import { renderPage } from "./render.tsx";
import { LoginPage, MagicLinkSentPage } from "../views/login.tsx";
import { ErrorPage } from "../views/messages.tsx";

const PROVIDER_MAP = { x: "twitter", discord: "discord" } as const;

/** better-auth の Set-Cookie をそのままレスポンスへ転送する。 */
function forwardSetCookie(c: Context<AppEnv>, headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    c.header("set-cookie", cookie, { append: true });
  }
}

/**
 * better-auth の APIError を 400/403 の ErrorPage に変換する。詳細は logger に残す。
 * APIError 以外は上位 (app.onError) に投げっぱなしにする。
 */
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

export function createAuthRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/login", (c) => {
    if (c.get("user") !== undefined) {
      return c.redirect("/", 302);
    }
    const methods = deps.adminService.getAuthMethods();
    return renderPage(
      c,
      deps,
      <LoginPage methods={methods} devLogin={deps.config.auth.devLogin} />,
    );
  });

  app.get("/auth/:provider{x|discord}", async (c) => {
    const provider = c.req.param("provider") as keyof typeof PROVIDER_MAP;
    const methods = deps.adminService.getAuthMethods();
    if (!methods.enabled[provider]) {
      return c.notFound();
    }
    try {
      const { headers, response } = await deps.auth.api.signInSocial({
        body: { provider: PROVIDER_MAP[provider], callbackURL: "/" },
        ...betterAuthServerCall(c),
        returnHeaders: true,
      });
      forwardSetCookie(c, headers);
      if (response.url === undefined) {
        throw new Error("signInSocial: response.url is missing");
      }
      return c.redirect(response.url, 302);
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
  });

  app.post("/auth/magic-link", async (c) => {
    const methods = deps.adminService.getAuthMethods();
    if (!methods.enabled.email) {
      return c.notFound();
    }
    const body = await parseStringBody(c);
    const { email } = parseMagicLinkForm(body);
    const name = email.split("@")[0] ?? email;
    try {
      await deps.auth.api.signInMagicLink({
        body: { email, name, callbackURL: "/" },
        ...betterAuthServerCall(c),
      });
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return renderPage(c, deps, <MagicLinkSentPage mailerIsConsole={methods.mailerIsConsole} />);
  });

  app.post("/auth/dev", async (c) => {
    if (!deps.config.auth.devLogin) {
      return c.notFound();
    }
    const body = await parseStringBody(c);
    const { email } = parseDevLoginForm(body);
    try {
      const { headers } = await deps.auth.api.devLogin({
        body: { email },
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      forwardSetCookie(c, headers);
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return c.redirect("/", 302);
  });

  app.post("/logout", async (c) => {
    try {
      const { headers } = await deps.auth.api.signOut({
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      forwardSetCookie(c, headers);
    } catch (err) {
      return renderAuthApiError(c, deps, err);
    }
    return c.redirect("/", 302);
  });

  return app;
}
