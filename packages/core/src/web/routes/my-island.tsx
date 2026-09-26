// tmp/14-users-auth.md ルート表、tmp/18-games.md「ルート」節: `/games/:gameId{[0-9]+}` 配下の
// GET /my-island, POST /my-island/commands|comment|name|lbbs/delete。
import { Hono } from "hono";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { parseStringBody } from "../forms/common.ts";
import {
  parseAbandonForm,
  parseCommandForm,
  parseCommentForm,
  parseLbbsDeleteForm,
  parseNameForm,
} from "../forms/island-forms.ts";
import { listIslandSelectOptions, requireGameIdParam } from "./helpers.ts";
import { renderPage } from "./render.tsx";
import { MyIslandPage } from "../views/my-island.tsx";
import { TopPage } from "../views/top.tsx";

/** `/games/:gameId{[0-9]+}` 配下にマウントする、自分の島の開発画面のルート。 */
export function createMyIslandRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/my-island", (c) => {
    const gameId = requireGameIdParam(c);
    const vm = deps.gameService.openOwnerPage(c.get("user"), gameId);
    const targets = listIslandSelectOptions(deps.gameService, gameId);
    return renderPage(
      c,
      deps,
      <MyIslandPage
        vm={vm}
        config={deps.config.game}
        targets={targets}
        csrfToken={c.get("csrfToken") ?? ""}
        timezone={deps.siteSettings.get().timezone}
        useLbbs={deps.siteSettings.get().useLbbs}
      />,
    );
  });

  app.post("/my-island/commands", async (c) => {
    const gameId = requireGameIdParam(c);
    const body = await parseStringBody(c);
    const form = parseCommandForm(body);
    const result = deps.gameService.registerCommand(c.get("user"), gameId, form.input);
    const targets = listIslandSelectOptions(deps.gameService, gameId);
    return renderPage(
      c,
      deps,
      <MyIslandPage
        vm={result}
        config={deps.config.game}
        targets={targets}
        csrfToken={c.get("csrfToken") ?? ""}
        timezone={deps.siteSettings.get().timezone}
        useLbbs={deps.siteSettings.get().useLbbs}
        notice={result.notice}
      />,
    );
  });

  app.post("/my-island/comment", async (c) => {
    const gameId = requireGameIdParam(c);
    const body = await parseStringBody(c);
    const form = parseCommentForm(body);
    const result = deps.gameService.updateComment(c.get("user"), gameId, form.message);
    const targets = listIslandSelectOptions(deps.gameService, gameId);
    return renderPage(
      c,
      deps,
      <MyIslandPage
        vm={result}
        config={deps.config.game}
        targets={targets}
        csrfToken={c.get("csrfToken") ?? ""}
        timezone={deps.siteSettings.get().timezone}
        useLbbs={deps.siteSettings.get().useLbbs}
        notice={result.notice}
      />,
    );
  });

  app.post("/my-island/name", async (c) => {
    const gameId = requireGameIdParam(c);
    const body = await parseStringBody(c);
    const form = parseNameForm(body);
    const result = deps.gameService.changeName(c.get("user"), gameId, form.name);
    const targets = listIslandSelectOptions(deps.gameService, gameId);
    return renderPage(
      c,
      deps,
      <MyIslandPage
        vm={result}
        config={deps.config.game}
        targets={targets}
        csrfToken={c.get("csrfToken") ?? ""}
        timezone={deps.siteSettings.get().timezone}
        useLbbs={deps.siteSettings.get().useLbbs}
        notice={result.notice}
      />,
    );
  });

  app.post("/my-island/abandon", async (c) => {
    const gameId = requireGameIdParam(c);
    const body = await parseStringBody(c);
    parseAbandonForm(body);
    const result = deps.gameService.abandonIsland(c.get("user"), gameId);
    return renderPage(
      c,
      deps,
      <TopPage
        vm={result}
        config={deps.config.game}
        timezone={deps.siteSettings.get().timezone}
        now={deps.clock.now()}
        csrfToken={c.get("csrfToken")}
        notice={result.notice}
      />,
    );
  });

  app.post("/my-island/lbbs/delete", async (c) => {
    const gameId = requireGameIdParam(c);
    const body = await parseStringBody(c);
    const form = parseLbbsDeleteForm(body);
    const result = deps.gameService.deleteLbbs(c.get("user"), gameId, form.number);
    const targets = listIslandSelectOptions(deps.gameService, gameId);
    return renderPage(
      c,
      deps,
      <MyIslandPage
        vm={result}
        config={deps.config.game}
        targets={targets}
        csrfToken={c.get("csrfToken") ?? ""}
        timezone={deps.siteSettings.get().timezone}
        useLbbs={deps.siteSettings.get().useLbbs}
        notice={result.notice}
      />,
    );
  });

  return app;
}
