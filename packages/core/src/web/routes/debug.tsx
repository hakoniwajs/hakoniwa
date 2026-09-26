// tmp/08-turn-trigger-admin-cli.md 「デバッグ用 POST /turn」節。v2 (14) では管理者セッションも必須。
// config.debug=false なら app.tsx がこのルーターをマウントしないため 404 になる。
import { Hono } from "hono";
import { AppError } from "../../app/errors.ts";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { requireCurrentGameId } from "./helpers.ts";
import { renderPage } from "./render.tsx";
import { TopPage } from "../views/top.tsx";

export function createDebugRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/turn", (c) => {
    const user = c.get("user");
    if (user === undefined) {
      throw new AppError("login_required");
    }
    if (!user.isAdmin) {
      throw new AppError("forbidden");
    }
    deps.turnService.advanceTurn(deps.clock.now());
    const gameId = requireCurrentGameId(deps.gameService);
    const vm = deps.gameService.getTopPage(user, gameId);
    return renderPage(
      c,
      deps,
      <TopPage
        vm={vm}
        config={deps.config.game}
        timezone={deps.siteSettings.get().timezone}
        now={deps.clock.now()}
        csrfToken={c.get("csrfToken")}
      />,
    );
  });

  return app;
}
