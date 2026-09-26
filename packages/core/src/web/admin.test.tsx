import { describe, expect, it } from "vitest";
import { currentGameId, currentMeta, loginAs, postForm, setupTestApp } from "./test-helpers.ts";
import type { TestApp } from "./test-helpers.ts";

const ADMIN_EMAIL = "admin@example.com";

async function loginAdmin(testApp: TestApp) {
  return loginAs(testApp, { id: "admin1", name: "かんりしゃ", email: ADMIN_EMAIL });
}

describe("管理画面 (/admin)", () => {
  it("adminEnabled=false なら GET /admin も 404", async () => {
    const { app } = setupTestApp({ adminEnabled: false });
    const res = await app.request("/admin");
    expect(res.status).toBe(404);
  });

  it("未ログインでの GET /admin は /login へ 302", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/admin", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("管理者以外の GET /admin は 403", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const auth = await loginAs(testApp, { id: "u1", name: "いっぱん", email: "u1@example.com" });
    const res = await testApp.app.request("/admin", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(403);
  });

  it("管理者以外の POST /admin/reset は 403", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const auth = await loginAs(testApp, { id: "u1", name: "いっぱん", email: "u1@example.com" });
    const res = await postForm(
      testApp.app,
      "/admin/reset",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(403);
  });

  it("管理者は GET /admin が 200 でメンテナンスツールを表示する (ゲーム名・状態・ID を含む)", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("メンテナンスツール");
    expect(html).toContain("現役データ");
    expect(html).toContain("第 1 回");
    expect(html).toContain("<b>ID</b>:1");
    expect(html).toContain("ゲーム一覧");
  });

  it("未初期化なら「新しいゲームを開始」フォームを表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).toContain("新しいゲームを開始");
    expect(html).toContain('action="/admin/games"');
  });

  it("_csrf なしの POST /admin/games は 403", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await postForm(testApp.app, "/admin/games", {}, { cookie: admin.cookie });
    expect(res.status).toBe(403);
  });

  it("POST /admin/games: 管理者は新しいゲームを開始できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games",
      { _csrf: admin.csrfToken },
      {
        cookie: admin.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("新しいゲームを開始しました");
    expect(testApp.repo.isInitialized()).toBe(true);
    // tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: 新しいゲームは turn=0。
    expect(currentMeta(testApp).turn).toBe(0);
    expect(currentMeta(testApp).name).toBe("第 1 回");
  });

  it("POST /admin/games: name を指定できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    await postForm(
      testApp.app,
      "/admin/games",
      { name: "特別編", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(currentMeta(testApp).name).toBe("特別編");
  });

  it("POST /admin/games: 現在のゲームが running のときは 409 で「現在のゲームが終了していません」", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("現在のゲームが終了していません");
  });

  it("running のときは「新しいゲームを開始」フォームの代わりに案内文を表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).not.toContain('action="/admin/games" method="post"');
    expect(html).toContain("現在のゲームが終了していません。");
  });

  it("POST /admin/games/current/finish: confirm チェックなしは 400 (invalid_input)", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games/current/finish",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(400);
    expect(currentMeta(testApp).status).toBe("running");
  });

  it("POST /admin/games/current/finish: confirm 付きでゲームを終了できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games/current/finish",
      { confirm: "on", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("このゲームを終了しました");
    expect(currentMeta(testApp).status).toBe("finished");
  });

  it("finished のときは「このゲームを終了する」フォームの代わりに案内文を表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    await postForm(
      testApp.app,
      "/admin/games/current/finish",
      { confirm: "on", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).not.toContain('action="/admin/games/current/finish"');
    expect(html).toContain("このゲームは既に終了しています。");
    // finished になったので「新しいゲームを開始」フォームが出る。
    expect(html).toContain('action="/admin/games"');
  });

  it("POST /admin/turn: ターンを進められる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/turn",
      { _csrf: admin.csrfToken },
      {
        cookie: admin.cookie,
      },
    );
    expect(res.status).toBe(200);
    // tmp/16-season.md「開始前の状態 = ターン 0」節: setupTestApp の既定ゲームは turn=0 (開始前)、
    // startAt=INITIAL_CLOCK=clock.now() で作られるため、1 ターン進めると turn=1 になる。
    expect(currentMeta(testApp).turn).toBe(1);
  });

  it("POST /admin/reset: 現役データを削除できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/reset",
      { _csrf: admin.csrfToken },
      {
        cookie: admin.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(testApp.repo.isInitialized()).toBe(false);
  });

  it("POST /admin/last-time: unix 秒指定で変更できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/last-time",
      { unix: 12345, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(currentMeta(testApp).lastTime).toBe(12345);
  });

  it("POST /admin/backups → restore で「復元しました」を表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const create = await postForm(
      testApp.app,
      "/admin/backups",
      { label: "b1", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(create.status).toBe(200);
    expect(await create.text()).toContain("バックアップを作成しました");

    const restore = await postForm(
      testApp.app,
      "/admin/backups/b1/restore",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(restore.status).toBe(200);
    expect(await restore.text()).toContain("復元しました。再読み込みしてください");
  });

  it("POST /admin/backups/:label/delete でバックアップを削除できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    await postForm(
      testApp.app,
      "/admin/backups",
      { label: "b1", _csrf: admin.csrfToken },
      {
        cookie: admin.cookie,
      },
    );
    const del = await postForm(
      testApp.app,
      "/admin/backups/b1/delete",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(del.status).toBe(200);
    expect(await del.text()).toContain("バックアップを削除しました");
  });

  it("POST /admin/auth-methods: ログイン方法のトグルを変更できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    expect(testApp.adminService.getAuthMethods().enabled.email).toBe(true);

    const res = await postForm(
      testApp.app,
      "/admin/auth-methods",
      { _csrf: admin.csrfToken },
      {
        cookie: admin.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ログイン方法の設定を変更しました");
    expect(testApp.adminService.getAuthMethods().enabled.email).toBe(false);
  });

  it("GET /admin: 「サイト設定」フォームに現在の値を表示する", async () => {
    const testApp = setupTestApp({
      adminEmails: [ADMIN_EMAIL],
      site: { title: "げんざいのたいとる", ngWords: ["いち", "に"], useLbbs: true },
    });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).toContain("サイト設定");
    expect(html).toContain('action="/admin/site-settings"');
    expect(html).toContain(
      'name="title" size="32" maxlength="64" required="" value="げんざいのたいとる"',
    );
    expect(html).toContain("いち\nに</textarea>");
    expect(html).toMatch(/name="use-lbbs" checked/);
  });

  it("POST /admin/site-settings: サイト設定を保存し、すぐにヘッダ・フッタへ反映される", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/site-settings",
      {
        _csrf: admin.csrfToken,
        title: " あたらしいしま ",
        "admin-name": "かんりにん",
        email: "admin@example.com",
        "bbs-url": "https://example.com/bbs",
        "toppage-url": "",
        "ng-words": "だめ\r\nぜったい, だめ",
        "use-lbbs": "on",
        timezone: "UTC",
      },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("サイト設定を変更しました。");
    expect(html).toContain("<title>あたらしいしま</title>");
    expect(testApp.siteSettings.get()).toEqual({
      title: "あたらしいしま",
      adminName: "かんりにん",
      email: "admin@example.com",
      bbsUrl: "https://example.com/bbs",
      topPageUrl: "",
      ngWords: ["だめ", "ぜったい"],
      useLbbs: true,
      timezone: "UTC",
    });

    const top = await (await testApp.app.request("/games/1")).text();
    expect(top).toContain("<title>あたらしいしま</title>");
    expect(top).toContain("管理者:かんりにん");
    expect(top).toContain('掲示板(<a href="https://example.com/bbs">');
    expect(top).not.toContain("トップページ(");
  });

  it("POST /admin/site-settings: チェックボックスが無ければローカル掲示板は無効になる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], site: { useLbbs: true } });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/site-settings",
      { _csrf: admin.csrfToken, title: "しま", timezone: "Asia/Tokyo" },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(testApp.siteSettings.get().useLbbs).toBe(false);
  });

  it.each([
    ["タイトルが空", { title: "  " }],
    ["タイトルが長すぎる", { title: "あ".repeat(65) }],
    ["http(s) 以外の URL", { "bbs-url": "javascript:alert(1)" }],
    ["URL として解釈できない", { "toppage-url": "not a url" }],
    ["メールアドレスの形式が不正", { email: "not-an-email" }],
    ["不正なタイムゾーン", { timezone: "Mars/Olympus" }],
    ["タイムゾーンが空", { timezone: "" }],
    ["NG ワードが長すぎる", { "ng-words": "あ".repeat(65) }],
  ])("POST /admin/site-settings: %s なら 400 で保存しない", async (_label, fields) => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const before = testApp.siteSettings.get();
    const res = await postForm(
      testApp.app,
      "/admin/site-settings",
      { _csrf: admin.csrfToken, title: "しま", timezone: "Asia/Tokyo", ...fields },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(400);
    expect(testApp.siteSettings.get()).toEqual(before);
  });

  it("管理者以外の POST /admin/site-settings は 403", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const auth = await loginAs(testApp, { id: "u1", name: "いっぱん", email: "u1@example.com" });
    const res = await postForm(
      testApp.app,
      "/admin/site-settings",
      { _csrf: auth.csrfToken, title: "のっとり", timezone: "UTC" },
      { cookie: auth.cookie },
    );
    expect(res.status).toBe(403);
    expect(testApp.siteSettings.get().title).not.toBe("のっとり");
  });

  it("POST /admin/maximize: 島の資金・食料を最大化できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const owner = await loginAs(testApp, { id: "u1", name: "しまぬし", email: "u1@example.com" });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすとじま", _csrf: owner.csrfToken },
      {
        cookie: owner.cookie,
      },
    );

    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/maximize",
      { id: 1, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("資金・食料を最大化しました");
    const island = testApp.repo.findIsland(currentGameId(testApp), 1);
    expect(island?.money).toBe(9999);
    expect(island?.food).toBe(9999);
  });
});

describe("tmp/16-season.md: 管理画面の開始時刻・最終ターン", () => {
  it("GET /admin: 現役データに開始時刻・最終ターン・状態を表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], finalTurn: 20 });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).toContain("開始時刻");
    expect(html).toContain("最終ターン");
    expect(html).toContain("20");
    expect(html).toContain("進行中");
  });

  it("POST /admin/games: 開始日時 (start-at) と最終ターン数 (final-turn) を指定して開始できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games",
      { "start-at": "2026-10-01T21:00", "final-turn": 50, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    const meta = currentMeta(testApp);
    expect(meta.finalTurn).toBe(50);
    // tmp/16-season.md「開始前の状態 = ターン 0」節: 開始日時が未来 (2026-10-01) なので turn=0 (開始前)。
    expect(meta.turn).toBe(0);
    expect(meta.lastTime).toBe(meta.startAt);
  });

  it("POST /admin/games: start-at/final-turn を省略すると従来どおり (現在時刻の切り下げ・無期限)", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(currentMeta(testApp).finalTurn).toBeNull();
  });

  it("POST /admin/final-turn: 最終ターン数を変更できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/final-turn",
      { "final-turn": 30, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("最終ターン数を変更しました");
    expect(currentMeta(testApp).finalTurn).toBe(30);
  });

  it("POST /admin/final-turn: 空欄なら無期限 (null) に戻せる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], finalTurn: 10 });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/final-turn",
      { "final-turn": "", _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(currentMeta(testApp).finalTurn).toBeNull();
  });
});

describe("tmp/16-season.md: ターンの長さも DB に持つ (追加要件)", () => {
  it("GET /admin: 現役データに「1 ターンの長さ」を整形して表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], unitTimeSec: 21600 });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    expect(html).toContain("1 ターンの長さ");
    expect(html).toContain("6時間");
  });

  it("未初期化の「新しいゲームを開始」フォームは config.unitTimeSec を既定値として表示する", async () => {
    const testApp = setupTestApp({
      adminEmails: [ADMIN_EMAIL],
      skipInit: true,
      gameOverrides: { unitTimeSec: 3600 },
    });
    const admin = await loginAdmin(testApp);
    const res = await testApp.app.request("/admin", { headers: { cookie: admin.cookie } });
    const html = await res.text();
    // unitTimeSec: 3600 → 1 時間 0 分。
    expect(html).toMatch(/name="unit-hours"[^>]*value="1"/);
    expect(html).toMatch(/name="unit-minutes"[^>]*value="0"/);
  });

  it("POST /admin/games: unit-hours/unit-minutes を指定して開始できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL], skipInit: true });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/games",
      { "unit-hours": 0, "unit-minutes": 1, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(currentMeta(testApp).unitTimeSec).toBe(60);
  });

  it("POST /admin/games: unit-time を省略すると config.unitTimeSec が使われる", async () => {
    const testApp = setupTestApp({
      adminEmails: [ADMIN_EMAIL],
      skipInit: true,
      gameOverrides: { unitTimeSec: 3600 },
    });
    const admin = await loginAdmin(testApp);
    await postForm(
      testApp.app,
      "/admin/games",
      { _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(currentMeta(testApp).unitTimeSec).toBe(3600);
  });

  it("POST /admin/unit-time: 1 ターンの長さを変更できる (lastTime は変わらない)", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const before = currentMeta(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/unit-time",
      { "unit-hours": 0, "unit-minutes": 2, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("1 ターンの長さを変更しました");
    const after = currentMeta(testApp);
    expect(after.unitTimeSec).toBe(120);
    expect(after.lastTime).toBe(before.lastTime);
  });

  it("POST /admin/unit-time: 合計 60 秒未満は 400 (invalid_input)", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN_EMAIL] });
    const admin = await loginAdmin(testApp);
    const res = await postForm(
      testApp.app,
      "/admin/unit-time",
      { "unit-hours": 0, "unit-minutes": 0, _csrf: admin.csrfToken },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(400);
  });
});
