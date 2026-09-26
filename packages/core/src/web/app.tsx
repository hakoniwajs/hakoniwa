// tmp/06-web-routes-and-views.md 「ルーティング」「ミドルウェア」節、tmp/14-users-auth.md
// のルート表・ミドルウェア順 (session → csrf → turn-check) への置き換え。ランタイム非依存の
// Hono app 組み立て。
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { AppError } from "../app/errors.ts";
import type { WebDeps } from "./deps.ts";
import type { AppEnv } from "./env.ts";
import { csrfMiddleware } from "./middleware/csrf.tsx";
import { sessionMiddleware } from "./middleware/session.ts";
import { turnCheckMiddleware } from "./middleware/turn-check.ts";
import { renderPage } from "./routes/render.tsx";
import { createAccountRoutes } from "./routes/account.tsx";
import { createAdminRoutes } from "./routes/admin.tsx";
import { createAuthRoutes } from "./routes/auth.tsx";
import { createDebugRoutes } from "./routes/debug.tsx";
import { createGamesRoutes } from "./routes/games.tsx";
import { createIslandsRoutes } from "./routes/islands.tsx";
import { createLegacyRoutes } from "./routes/legacy.tsx";
import { createMyIslandRoutes } from "./routes/my-island.tsx";
import { createGameTopRoutes, createTopRoutes } from "./routes/top.tsx";
import { ErrorPage, errorMessage, errorStatus } from "./views/messages.tsx";

/**
 * tmp/17-ogp.md 「キャッシュ (Workers Cache)」節: Workers Cache は `Cache-Control` の無い応答も
 * RFC 9111 のヒューリスティックでキャッシュしてしまう (Cookie 付きリクエストもバイパスしない。
 * `Set-Cookie` を含む応答と `Authorization` 付きリクエストだけがバイパス対象)。セッション依存の
 * HTML (`/api/auth/*` の better-auth 応答を含む) が他人に配られないよう、ここで全応答に既定
 * `Cache-Control: private, no-store` を付ける。ルート側が既に `Cache-Control` を設定していれば
 * それを優先する (`/islands/:id/ogp.png` は `public, max-age=3600` を明示している)。
 */
const defaultCacheControlMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "private, no-store");
  }
};

/** ランタイム非依存の Hono app を組み立てる。静的配信 (`/images/*`, `/style.css`, `/owner.js`) は Adapter の責務。 */
export function createApp(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // すべての応答 (/api/auth/* を含む) に既定の Cache-Control を付ける。最初に登録し、
  // 他のすべてのルート/ミドルウェアの外側で作用させる。
  app.use("*", defaultCacheControlMiddleware);

  // better-auth の HTTP エンドポイント。session/csrf/turn-check より前に (最初に) マウントし、
  // それらのミドルウェアを経由させない (better-auth 自身が Cookie とセッションを扱う。
  // trustedOrigins による Origin 検証も better-auth 側の責務)。
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  app.use("*", sessionMiddleware({ auth: deps.auth, adminPolicy: deps.adminPolicy }));
  app.use(
    "*",
    csrfMiddleware({
      secret: deps.authSecret,
      ...(deps.config.auth.baseUrl !== undefined ? { baseUrl: deps.config.auth.baseUrl } : {}),
      siteSettings: deps.siteSettings,
    }),
  );

  // ゲーム系ルートの前にターン進行判定。auth/account/admin/静的には掛けない。
  // tmp/18-games.md「ルート」節: パスに依らず 1 回進行判定できればよいので、ゲーム系ルート
  // (トップ・ゲーム一覧・`/games/*`・旧 URL) すべてに掛けておく。
  const turnCheck = turnCheckMiddleware({ turnService: deps.turnService, clock: deps.clock });
  app.use("/", turnCheck);
  app.use("/games", turnCheck);
  app.use("/games/*", turnCheck);
  app.use("/islands", turnCheck);
  app.use("/islands/*", turnCheck);
  app.use("/my-island", turnCheck);
  app.use("/my-island/*", turnCheck);
  app.use("/turn", turnCheck);

  app.route("/", createAuthRoutes(deps));
  app.route("/", createAccountRoutes(deps));
  app.route("/", createTopRoutes(deps));
  app.route("/", createGamesRoutes(deps));
  app.route("/", createLegacyRoutes(deps));
  // tmp/18-games.md「ルート」節: 全ページを `/games/:gameId{[0-9]+}` 配下にする。
  app.route("/games/:gameId{[0-9]+}", createGameTopRoutes(deps));
  app.route("/games/:gameId{[0-9]+}", createIslandsRoutes(deps));
  app.route("/games/:gameId{[0-9]+}", createMyIslandRoutes(deps));

  // config.debug=false の場合は POST /turn 自体を無効化する。
  if (deps.config.debug) {
    app.route("/", createDebugRoutes(deps));
  }

  // adminEnabled=false の場合は /admin/* すべて無効化する。
  if (deps.config.adminEnabled) {
    app.route("/", createAdminRoutes(deps));
  }

  app.onError((err, c) => {
    if (err instanceof AppError) {
      // GET の login_required はログイン画面へ誘導する (POST は 401 画面のまま)。
      if (err.kind === "login_required" && c.req.method === "GET") {
        return c.redirect("/login", 302);
      }
      // no_island はトップへ戻し、通知として表示する (GET/POST 共通)。
      // tmp/18-games.md: トップは `/games/:id` に移ったため、現在のゲームがあればそちらへ戻す。
      if (err.kind === "no_island") {
        const currentId = deps.gameService.getCurrentGameId();
        const target = currentId !== undefined ? `/games/${currentId}` : "/";
        return c.redirect(`${target}?notice=no_island`, 302);
      }
      return renderPage(
        c,
        deps,
        <ErrorPage message={errorMessage(err.kind)} />,
        errorStatus(err.kind),
      );
    }
    // 想定外のエラー。Perl 版 tempProblem 相当。
    return renderPage(c, deps, <ErrorPage message="問題発生、とりあえず戻ってください。" />, 500);
  });

  return app;
}
