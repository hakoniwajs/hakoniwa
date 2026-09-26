// tmp/06-web-routes-and-views.md / tmp/08-turn-trigger-admin-cli.md / tmp/14-users-auth.md の結合テスト。
// 実 DB (:memory:) + 実 better-auth (composeNode) + 開発ログインを使い、Perl 版 t/Main.t 相当
// (トップ/新規作成/観光/開発/コマンド/コメント) と t/Maintenance.t 相当 (管理: 初期化/削除) を確認する。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, defaultSiteSettings } from "@hakoniwajs/core";
import type { GameConfig } from "@hakoniwajs/core";
import { afterEach, describe, expect, it } from "vitest";
import { composeNode } from "../src/compose.ts";
import type { ComposedNode } from "../src/compose.ts";
import type { NodeConfig } from "../src/config.ts";

interface SetupOptions {
  debug?: boolean;
  adminEmails?: string[];
  /** 初期化 (adminService.initialize) をスキップする (未初期化/初期化テスト用)。 */
  skipInit?: boolean;
  gameOverrides?: Partial<GameConfig>;
}

interface Ctx {
  deps: ComposedNode;
  backupDir: string;
}

/**
 * `:memory:` DB + 一時バックアップディレクトリで `composeNode` する。開発ログイン
 * (`HAKONIWA_DEV_LOGIN` 相当) を常に有効にし、実 better-auth 経由でログインする。
 * `Clock` はシステム時計 (`composeNode` 既定) なので、`lastTime` は実時間の直近の
 * `unitTimeSec` 境界に切り下げる。実時間との差が `unitTimeSec` を超えないため、
 * `turnCheckMiddleware` によるターンの巻き戻し進行は起きない。
 */
function setup(options: SetupOptions = {}): Ctx {
  const backupDir = mkdtempSync(join(tmpdir(), "hakoniwa-web-test-"));
  const debug = options.debug ?? false;
  const config: NodeConfig = {
    game: { ...defaultConfig, debug, ...options.gameOverrides },
    auth: {
      baseUrl: "http://localhost:5173",
      secret: "a".repeat(32),
      devLogin: true,
      adminEmails: options.adminEmails ?? [],
    },
    mail: { mailFrom: "hakoniwa@example.com" },
    adminEnabled: true,
    debug,
    siteDefaults: defaultSiteSettings,
    port: 0,
    dbPath: ":memory:",
    backupDir,
    turnCheckIntervalSec: 0,
  };
  const deps = composeNode(config);
  if (options.skipInit !== true) {
    const now = Math.floor(Date.now() / 1000);
    deps.adminService.initialize(now);
  }
  return { deps, backupDir };
}

function formBody(fields: Record<string, string | number>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, String(value));
  }
  return params;
}

/** Set-Cookie のうち `name=value` の部分だけを取り出す (属性は落とす)。 */
function cookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (setCookieHeader === null) {
    return undefined;
  }
  for (const part of setCookieHeader.split(/,(?=[^;]+?=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.split(";")[0];
    }
  }
  return undefined;
}

async function postForm(
  app: ComposedNode["app"],
  path: string,
  fields: Record<string, string | number>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    body: formBody(fields),
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  });
}

/** `_csrf` を HTML から取り出す (最初に見つかったものを使う)。 */
function extractCsrfToken(html: string): string {
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(`_csrf token not found in HTML: ${html.slice(0, 200)}`);
  }
  return match[1];
}

/**
 * 開発ログイン (POST /auth/dev) でログインし、Cookie ヘッダと `_csrf` トークンを返す。
 * `_csrf` の取得元には `/account` を使う (ゲームの有無に関わらず 200 を返し、Layout の
 * ナビ (ログアウトフォーム) に `_csrf` を含む)。
 */
async function devLogin(
  app: ComposedNode["app"],
  email: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const res = await postForm(app, "/auth/dev", { email }, { origin: "http://localhost:5173" });
  expect(res.status).toBe(302);
  const cookie = cookieValue(res.headers.get("set-cookie"), "hako.session_token");
  if (cookie === undefined) {
    throw new Error(`hako.session_token cookie not set: ${res.headers.get("set-cookie")}`);
  }
  const account = await app.request("/account", { headers: { cookie } });
  const csrfToken = extractCsrfToken(await account.text());
  return { cookie, csrfToken };
}

async function createIsland(
  app: ComposedNode["app"],
  auth: { cookie: string; csrfToken: string },
  name: string,
): Promise<Response> {
  return await postForm(
    app,
    "/games/1/islands",
    { name, _csrf: auth.csrfToken },
    { cookie: auth.cookie },
  );
}

describe("packages/node 結合テスト (実 DB :memory: + 実 better-auth devLogin)", () => {
  let ctx: Ctx | undefined;

  afterEach(() => {
    if (ctx !== undefined) {
      ctx.deps.driver.close();
      rmSync(ctx.backupDir, { recursive: true, force: true });
      ctx = undefined;
    }
  });

  it("トップ表示: 未初期化なら 200「ゲームはまだ開始されていません。」", async () => {
    ctx = setup({ skipInit: true });
    const res = await ctx.deps.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ゲームはまだ開始されていません");
  });

  it("トップ表示: GET / は /games/1 へ 302。初期化後は 200 でターン1と配布元リンクを表示する", async () => {
    ctx = setup();
    const redirectRes = await ctx.deps.app.request("/", { redirect: "manual" });
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get("location")).toBe("/games/1");

    const res = await ctx.deps.app.request("/games/1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h2>ターン 1</h2>");
    expect(html).toContain("箱庭諸島スクリプト配布元");
  });

  it("GET /login: 開発ログインフォームを表示する", async () => {
    ctx = setup();
    const res = await ctx.deps.app.request("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("開発ログイン");
    expect(html).toContain('action="/auth/dev"');
  });

  it("開発ログイン → Cookie を持って /games/1 にアクセスすると「新しい島を探す」導線が出る", async () => {
    ctx = setup();
    const auth = await devLogin(ctx.deps.app, "player1@example.com");
    const res = await ctx.deps.app.request("/games/1", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("新しい島を探す");
  });

  it("新しい島を探す → /my-island → 計画登録 → コメント → ログアウト後は /my-island が 302", async () => {
    ctx = setup();
    const auth = await devLogin(ctx.deps.app, "player2@example.com");

    const createRes = await createIsland(ctx.deps.app, auth, "てすとじま");
    expect(createRes.status).toBe(200);
    expect(await createRes.text()).toContain("「てすとじま島」");

    // /my-island (ゲーム ID を含まない旧 URL) は /games/1/my-island へ 302。
    const myIslandRedirect = await ctx.deps.app.request("/my-island", {
      headers: { cookie: auth.cookie },
      redirect: "manual",
    });
    expect(myIslandRedirect.status).toBe(302);
    expect(myIslandRedirect.headers.get("location")).toBe("/games/1/my-island");

    const myIslandRes = await ctx.deps.app.request("/games/1/my-island", {
      headers: { cookie: auth.cookie },
    });
    expect(myIslandRes.status).toBe(200);
    const myIslandHtml = await myIslandRes.text();
    expect(myIslandHtml).toContain("開発計画");
    expect(myIslandHtml).toContain("/owner.js");
    expect(myIslandHtml).toContain("map-cell");

    const commandRes = await postForm(
      ctx.deps.app,
      "/games/1/my-island/commands",
      {
        _csrf: auth.csrfToken,
        number: 0,
        kind: 1,
        x: 0,
        y: 0,
        amount: 0,
        target: 0,
        mode: "insert",
      },
      { cookie: auth.cookie },
    );
    expect(commandRes.status).toBe(200);
    expect(await commandRes.text()).toContain("コマンドを登録しました");

    const commentRes = await postForm(
      ctx.deps.app,
      "/games/1/my-island/comment",
      { _csrf: auth.csrfToken, message: "よろしくお願いします" },
      { cookie: auth.cookie },
    );
    expect(commentRes.status).toBe(200);
    expect(await commentRes.text()).toContain("コメントを更新しました");

    const top = await ctx.deps.app.request("/games/1");
    expect(await top.text()).toContain("よろしくお願いします");

    const logoutRes = await postForm(
      ctx.deps.app,
      "/logout",
      { _csrf: auth.csrfToken },
      { cookie: auth.cookie },
    );
    expect(logoutRes.status).toBe(302);
    const loggedOutCookie =
      cookieValue(logoutRes.headers.get("set-cookie"), "hako.session_token") ?? auth.cookie;

    // /my-island (旧 URL) はログイン状態に関わらずまず /games/1/my-island へ 302 する。
    const afterLogout = await ctx.deps.app.request("/my-island", {
      headers: { cookie: loggedOutCookie },
      redirect: "manual",
    });
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.get("location")).toBe("/games/1/my-island");

    // その先 (/games/1/my-island) でログイン必須になり /login へ 302 する。
    const afterLogoutGameScoped = await ctx.deps.app.request("/games/1/my-island", {
      headers: { cookie: loggedOutCookie },
      redirect: "manual",
    });
    expect(afterLogoutGameScoped.status).toBe(302);
    expect(afterLogoutGameScoped.headers.get("location")).toBe("/login");
  });

  it("観光: GET /games/:gameId/islands/:id でようこそ画面を表示する (旧 URL は 302)", async () => {
    ctx = setup();
    const auth = await devLogin(ctx.deps.app, "player3@example.com");
    await createIsland(ctx.deps.app, auth, "てすとじま");

    const legacyRes = await ctx.deps.app.request("/islands/1", { redirect: "manual" });
    expect(legacyRes.status).toBe(302);
    expect(legacyRes.headers.get("location")).toBe("/games/1/islands/1");

    const res = await ctx.deps.app.request("/games/1/islands/1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("へようこそ！！");
  });

  it("名前変更: 資金不足のときは 400", async () => {
    ctx = setup();
    const auth = await devLogin(ctx.deps.app, "player4@example.com");
    await createIsland(ctx.deps.app, auth, "てすとじま");
    const res = await postForm(
      ctx.deps.app,
      "/games/1/my-island/name",
      { _csrf: auth.csrfToken, name: "しんめい" },
      { cookie: auth.cookie },
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("資金不足のため変更できません");
  });

  it("島を 10 個作成できる (ユーザーごとに 1 島)", async () => {
    ctx = setup();
    for (let i = 0; i < 10; i++) {
      const auth = await devLogin(ctx.deps.app, `player-multi-${i}@example.com`);
      const res = await createIsland(ctx.deps.app, auth, `島${i}`);
      expect(res.status).toBe(200);
    }
    const top = await ctx.deps.app.request("/games/1");
    const html = await top.text();
    for (let i = 0; i < 10; i++) {
      expect(html).toContain(`島${i}島`);
    }
  });

  it("管理: 管理者メールでログインして /admin が 200", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"] });
    const auth = await devLogin(ctx.deps.app, "admin@example.com");
    const res = await ctx.deps.app.request("/admin", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("メンテナンスツール");
  });

  it("管理: 管理者以外は /admin が 403", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"] });
    const auth = await devLogin(ctx.deps.app, "notadmin@example.com");
    const res = await ctx.deps.app.request("/admin", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(403);
  });

  it("管理: POST /admin/games で新しいゲームを開始できる", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"], skipInit: true });
    expect(ctx.deps.repo.isInitialized()).toBe(false);
    const auth = await devLogin(ctx.deps.app, "admin@example.com");
    const res = await postForm(
      ctx.deps.app,
      "/admin/games",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("新しいゲームを開始しました");
    expect(ctx.deps.repo.isInitialized()).toBe(true);
  });

  it("管理: POST /admin/reset で削除できる", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"] });
    const auth = await devLogin(ctx.deps.app, "admin@example.com");
    const res = await postForm(
      ctx.deps.app,
      "/admin/reset",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("データを削除しました");
    expect(ctx.deps.repo.isInitialized()).toBe(false);
  });

  it("管理: POST /admin/auth-methods で email を無効化すると /login にメールフォームが出ない", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"] });
    const auth = await devLogin(ctx.deps.app, "admin@example.com");

    const before = await ctx.deps.app.request("/login");
    expect(await before.text()).toContain('action="/auth/magic-link"');

    const res = await postForm(
      ctx.deps.app,
      "/admin/auth-methods",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(200);

    const after = await ctx.deps.app.request("/login");
    expect(await after.text()).not.toContain('action="/auth/magic-link"');
  });

  it("ターンを進める: debug=true かつ管理者で POST /turn するとターン2になる", async () => {
    ctx = setup({ debug: true, adminEmails: ["admin@example.com"] });
    const before = await ctx.deps.app.request("/games/1");
    expect(await before.text()).toContain("<h2>ターン 1</h2>");

    const auth = await devLogin(ctx.deps.app, "admin@example.com");
    const res = await postForm(
      ctx.deps.app,
      "/turn",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h2>ターン 2</h2>");
  });

  it("tmp/18-games.md: ゲーム終了 → 新しいゲーム開始 → 過去のゲームは閲覧できるが書き込みは 409、GET /games に 2 件", async () => {
    ctx = setup({ adminEmails: ["admin@example.com"] });
    const owner = await devLogin(ctx.deps.app, "owner@example.com");
    await createIsland(ctx.deps.app, owner, "てすとじま");

    const admin = await devLogin(ctx.deps.app, "admin@example.com");
    const finishRes = await postForm(
      ctx.deps.app,
      "/admin/games/current/finish",
      { confirm: "on", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(finishRes.status).toBe(200);

    const startRes = await postForm(
      ctx.deps.app,
      "/admin/games",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(startRes.status).toBe(200);

    // / は新しいゲーム (2) へ 302。
    const root = await ctx.deps.app.request("/", { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/games/2");

    // 過去のゲーム (1) は閲覧でき、OGP も見られる。
    const pastIsland = await ctx.deps.app.request("/games/1/islands/1");
    expect(pastIsland.status).toBe(200);
    const pastOgp = await ctx.deps.app.request("/games/1/islands/1/ogp.png");
    expect(pastOgp.status).toBe(200);

    // 過去のゲームへの記帳は 409。
    const writeRes = await postForm(
      ctx.deps.app,
      "/games/1/islands/1/lbbs",
      { _csrf: owner.csrfToken, message: "感想です" },
      { cookie: owner.cookie },
    );
    expect(writeRes.status).toBe(409);

    // 同じユーザーが新しいゲームで島を作れる (ゲームごとに 1 ユーザー 1 島)。
    const createRes2 = await postForm(
      ctx.deps.app,
      "/games/2/islands",
      { name: "にばんめのしま", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(createRes2.status).toBe(200);

    const gamesList = await ctx.deps.app.request("/games");
    const gamesHtml = await gamesList.text();
    expect(gamesHtml).toContain('href="/games/1"');
    expect(gamesHtml).toContain('href="/games/2"');
  });
});
