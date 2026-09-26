// tmp/08-turn-trigger-admin-cli.md 「Web 管理画面」節、tmp/14-users-auth.md
// 「認可ルール」節 (管理画面は管理者セッション必須) の移植。パスワード認証は撤去した。
import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthUser } from "../../app/auth.ts";
import { AppError } from "../../app/errors.ts";
import type { WebDeps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { parseStrictNonNegativeInt, parseStringBody } from "../forms/common.ts";
import {
  parseAdminBackupForm,
  parseAdminEmailForm,
  parseAdminLastTimeForm,
  parseAdminSetupForm,
  parseAuthMethodsForm,
  parseFinalTurnForm,
  parseFinishGameForm,
  parseSiteSettingsForm,
  parseStartGameForm,
  parseUnitTimeForm,
} from "../forms/admin-forms.ts";
import { listIslandSelectOptions } from "./helpers.ts";
import { renderPage } from "./render.tsx";
import { AdminPage } from "../views/admin.tsx";
import { AdminSetupPage } from "../views/admin-setup.tsx";

/** GET/POST とも管理者セッション必須。未ログインは login_required、非管理者は forbidden。 */
function requireAdmin(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (user === undefined) {
    throw new AppError("login_required");
  }
  if (!user.isAdmin) {
    throw new AppError("forbidden");
  }
  return user;
}

async function renderAdmin(c: Context<AppEnv>, deps: WebDeps, notice: string | undefined) {
  const status = await deps.adminService.status();
  const siteSettings = deps.siteSettings.get();
  const authMethods = deps.adminService.getAuthMethods();
  // 未初期化のときに gameService.getTopPage (listIslandSelectOptions が内部で呼ぶ) を叩くと
  // not_initialized で例外になるため、初期化済みのときだけ島一覧 (maximize 用) を取得する。
  const islands =
    status.initialized && status.gameId !== undefined
      ? listIslandSelectOptions(deps.gameService, status.gameId)
      : [];
  return renderPage(
    c,
    deps,
    <AdminPage
      status={status}
      authMethods={authMethods}
      adminEmails={deps.adminPolicy.emails()}
      islands={islands}
      siteSettings={siteSettings}
      defaultUnitTimeSec={deps.config.game.unitTimeSec}
      csrfToken={c.get("csrfToken") ?? ""}
      notice={notice}
    />,
  );
}

/** ログイン中ユーザーのメールアドレス。X ログインのプレースホルダ (`*.invalid`) なら undefined。 */
function realEmailOf(user: AuthUser): string | undefined {
  return user.email.toLowerCase().endsWith(".invalid") ? undefined : user.email;
}

/**
 * セットアップ画面を表示する。表示のたびにセットアップコードをサーバーのログへ出力する
 * (ログを読める運用者だけが管理者になれる。ConsoleMailer と同じ信頼モデル)。
 */
function renderSetup(
  c: Context<AppEnv>,
  deps: WebDeps,
  user: AuthUser,
  error: string | undefined,
  status?: 403,
) {
  const code = deps.adminPolicy.setupCode();
  deps.logger.warn(
    `[hakoniwa] 管理者のセットアップコード: ${code} (/admin/setup で入力すると、入力したユーザーが最初の管理者になります)`,
  );
  return renderPage(
    c,
    deps,
    <AdminSetupPage email={realEmailOf(user)} csrfToken={c.get("csrfToken") ?? ""} error={error} />,
    status,
  );
}

export function createAdminRoutes(deps: WebDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/admin", async (c) => {
    const user = c.get("user");
    // 管理者が 1 人もいなければ初期セットアップへ誘導する。
    if (user !== undefined && !user.isAdmin && deps.adminPolicy.needsSetup()) {
      return c.redirect("/admin/setup", 302);
    }
    requireAdmin(c);
    return renderAdmin(c, deps, undefined);
  });

  // 管理者の初期セットアップ。管理者が 1 人もいないときだけ使える (いれば 404)。
  app.get("/admin/setup", (c) => {
    if (!deps.adminPolicy.needsSetup()) {
      return c.notFound();
    }
    const user = c.get("user");
    if (user === undefined) {
      throw new AppError("login_required");
    }
    return renderSetup(c, deps, user, undefined);
  });

  app.post("/admin/setup", async (c) => {
    if (!deps.adminPolicy.needsSetup()) {
      return c.notFound();
    }
    const user = c.get("user");
    if (user === undefined) {
      throw new AppError("login_required");
    }
    const body = await parseStringBody(c);
    const code = parseAdminSetupForm(body);
    try {
      deps.adminPolicy.claimWithSetupCode(user.email, code);
    } catch (err) {
      if (err instanceof AppError && err.kind === "forbidden") {
        deps.logger.warn(
          `[hakoniwa] 管理者のセットアップコードが一致しませんでした (user: ${user.id})`,
        );
        return renderSetup(c, deps, user, "セットアップコードが違います。", 403);
      }
      throw err;
    }
    deps.logger.info(`[hakoniwa] ${user.email} を最初の管理者として登録しました。`);
    // セッションの user.isAdmin はこのリクエスト内では更新されないため、リダイレクトで読み直す。
    return c.redirect("/admin", 302);
  });

  app.post("/admin/admins", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const email = parseAdminEmailForm(body);
    deps.adminPolicy.addEmail(email);
    return renderAdmin(c, deps, "管理者を追加しました。");
  });

  app.post("/admin/admins/delete", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const email = parseAdminEmailForm(body);
    deps.adminPolicy.removeEmail(email);
    // 自分自身を削除した場合は管理画面を表示できなくなるので、トップへ戻す。
    const user = c.get("user");
    if (user !== undefined && !deps.adminPolicy.isAdmin(user.email)) {
      return c.redirect("/", 302);
    }
    return renderAdmin(c, deps, "管理者を削除しました。");
  });

  // tmp/18-games.md「ルート」節: 「新しいゲームを開始」。旧 POST /admin/init はこれに統合した。
  app.post("/admin/games", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const form = parseStartGameForm(body, deps.siteSettings.get().timezone);
    deps.adminService.startGame(form, deps.clock.now());
    return renderAdmin(c, deps, "新しいゲームを開始しました。");
  });

  // tmp/18-games.md「ルート」節: 「このゲームを終了する」。running のときのみ成功する。
  app.post("/admin/games/current/finish", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    parseFinishGameForm(body);
    deps.adminService.finishCurrentGame(deps.clock.now());
    return renderAdmin(c, deps, "このゲームを終了しました。");
  });

  app.post("/admin/reset", async (c) => {
    requireAdmin(c);
    deps.adminService.reset();
    return renderAdmin(c, deps, "データを削除しました。");
  });

  app.post("/admin/last-time", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const form = parseAdminLastTimeForm(body, deps.siteSettings.get().timezone);
    deps.adminService.setLastTime(form.unix);
    return renderAdmin(c, deps, "最終更新時間を変更しました。");
  });

  // 追加: tmp/16-season.md「設定の入口」節。「ゲーム設定」の最終ターン数変更。
  app.post("/admin/final-turn", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const finalTurn = parseFinalTurnForm(body);
    deps.adminService.setFinalTurn(finalTurn);
    return renderAdmin(c, deps, "最終ターン数を変更しました。");
  });

  // 追加: tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。「ゲーム設定」の
  // 1 ターンの長さ変更。lastTime は変えないため、次のターン境界から効く。
  app.post("/admin/unit-time", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const unitTimeSec = parseUnitTimeForm(body);
    deps.adminService.setUnitTimeSec(unitTimeSec);
    return renderAdmin(c, deps, "1 ターンの長さを変更しました。");
  });

  app.post("/admin/turn", async (c) => {
    requireAdmin(c);
    deps.adminService.advanceTurn(deps.clock.now());
    return renderAdmin(c, deps, "ターンを進めました。");
  });

  app.post("/admin/backups", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const form = parseAdminBackupForm(body);
    await deps.adminService.createBackup(form.label);
    return renderAdmin(c, deps, "バックアップを作成しました。");
  });

  app.post("/admin/backups/:label/restore", async (c) => {
    requireAdmin(c);
    await deps.adminService.restoreBackup(c.req.param("label"));
    return renderAdmin(c, deps, "復元しました。再読み込みしてください。");
  });

  app.post("/admin/backups/:label/delete", async (c) => {
    requireAdmin(c);
    await deps.adminService.deleteBackup(c.req.param("label"));
    return renderAdmin(c, deps, "バックアップを削除しました。");
  });

  // 追加: tmp/14-users-auth.md 「ログイン方法の設定」節。管理画面からの ON/OFF 切り替え。
  app.post("/admin/auth-methods", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const form = parseAuthMethodsForm(body);
    deps.adminService.setAuthMethods(form);
    return renderAdmin(c, deps, "ログイン方法の設定を変更しました。");
  });

  // 追加: サイト設定 (タイトル・フッタ・追加 NG ワード・ローカル掲示板・タイムゾーン)。
  // 以前は環境変数だったものを settings 表に保存する (app/site-settings.ts)。
  app.post("/admin/site-settings", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const form = parseSiteSettingsForm(body);
    deps.siteSettings.update(form);
    return renderAdmin(c, deps, "サイト設定を変更しました。");
  });

  // 追加: tmp/14-users-auth.md 「決定事項」6。特殊パスワードの代わりの資金・食料最大化。
  // 設計書との差異: タスク指示は `POST /admin/islands/:id/maximize` (島の select + ボタン) だが、
  // <select> だけで動的に POST 先の URL (path param) を変えるには JS が必要になる。
  // owner.js のような座標選択専用スクリプトをここに広げるより、id をフォームの通常フィールドで
  // 送る `POST /admin/maximize` (JS 不要) にした方が単純に動くため、こちらを採用した。
  app.post("/admin/maximize", async (c) => {
    requireAdmin(c);
    const body = await parseStringBody(c);
    const id = parseStrictNonNegativeInt(body, "id");
    deps.adminService.maximizeIsland(id);
    return renderAdmin(c, deps, "資金・食料を最大化しました。");
  });

  return app;
}
