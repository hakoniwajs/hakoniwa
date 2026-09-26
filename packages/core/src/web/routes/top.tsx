// tmp/14-users-auth.md ルート表、tmp/18-games.md「ルート」節: GET / (現在のゲームへ 302)、
// GET /games/:gameId (そのゲームのトップ)。
import { Hono } from "hono";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { renderPage } from "./render.tsx";
import { requireGameIdParam } from "./helpers.ts";
import { NoGamePage, TopPage } from "../views/top.tsx";
import { errorMessage } from "../views/messages.tsx";

/** GET /。現在のゲームへ 302。ゲームが無ければ「ゲームはまだ開始されていません」画面。 */
export function createTopRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const gameId = deps.gameService.getCurrentGameId();
    if (gameId === undefined) {
      const user = c.get("user");
      return renderPage(
        c,
        deps,
        <NoGamePage
          isAdmin={user?.isAdmin ?? false}
          needsAdminSetup={deps.config.adminEnabled && deps.adminPolicy.needsSetup()}
          loggedIn={user !== undefined}
        />,
      );
    }
    return c.redirect(`/games/${gameId}`, 302);
  });

  return app;
}

/** GET /games/:gameId{[0-9]+}。そのゲームのトップ画面。過去のゲームも見られる。 */
export function createGameTopRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const gameId = requireGameIdParam(c);
    const vm = deps.gameService.getTopPage(c.get("user"), gameId);
    // app.onError の no_island リダイレクト (`/games/:id?notice=no_island`) を受けての通知表示。
    const notice = c.req.query("notice") === "no_island" ? errorMessage("no_island") : undefined;
    return renderPage(
      c,
      deps,
      <TopPage
        vm={vm}
        config={deps.config.game}
        timezone={deps.config.timezone}
        now={deps.clock.now()}
        csrfToken={c.get("csrfToken")}
        notice={notice}
      />,
    );
  });

  return app;
}
