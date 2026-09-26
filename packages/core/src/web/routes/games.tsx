// tmp/18-games.md「ルート」節: GET /games (ゲーム一覧)。
import { Hono } from "hono";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { renderPage } from "./render.tsx";
import { GamesPage } from "../views/games.tsx";

/** GET /games。現在 + 過去のゲームを一覧表示する。ゲームが 1 つも無くても 200 (空一覧)。 */
export function createGamesRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/games", (c) => {
    const games = deps.gameService.listGames();
    const currentGameId = deps.gameService.getCurrentGameId();
    return renderPage(
      c,
      deps,
      <GamesPage
        games={games}
        currentGameId={currentGameId}
        timezone={deps.siteSettings.get().timezone}
      />,
    );
  });

  return app;
}
