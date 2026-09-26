// 管理者の初期セットアップ (`/admin/setup`) と、管理画面「管理者」節 (`/admin/admins`) のテスト。
import { describe, expect, it } from "vitest";
import { loginAs, postForm, setupTestApp } from "./test-helpers.ts";

const USER = { id: "u1", name: "うんようしゃ", email: "owner@example.com" };

describe("管理者の初期セットアップ (/admin/setup)", () => {
  it("管理者がいないとき、ログイン中の GET /admin は /admin/setup へ 302", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, USER);
    const res = await testApp.app.request("/admin", {
      headers: { cookie: auth.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/setup");
  });

  it("未ログインの GET /admin/setup は /login へ 302", async () => {
    const testApp = setupTestApp();
    const res = await testApp.app.request("/admin/setup", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("GET /admin/setup はフォームを表示し、セットアップコードをログにだけ出力する", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, USER);
    const res = await testApp.app.request("/admin/setup", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("管理者の初期設定");
    expect(html).toContain('name="code"');
    const code = testApp.adminPolicy.setupCode();
    expect(html).not.toContain(code);
    expect(testApp.logger.warns.some((msg) => msg.includes(code))).toBe(true);
  });

  it("X ログイン (メールアドレス無し) ではフォームを出さず、メールアドレスが必要な旨を表示する", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, {
      id: "x1",
      name: "えっくす",
      email: "123@x.placeholder.invalid",
    });
    const res = await testApp.app.request("/admin/setup", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("X ログインはメールアドレスを返さない");
    expect(html).not.toContain('name="code"');
  });

  it("正しいコードを POST すると管理者になり /admin を表示できる", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, USER);
    const code = testApp.adminPolicy.setupCode();
    const res = await postForm(
      testApp.app,
      "/admin/setup",
      { _csrf: auth.csrfToken, code },
      { cookie: auth.cookie },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
    expect(testApp.adminPolicy.storedEmails()).toEqual(["owner@example.com"]);

    const admin = await testApp.app.request("/admin", { headers: { cookie: auth.cookie } });
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain("メンテナンスツール");

    // 管理者ができたらセットアップ画面は 404。
    const setup = await testApp.app.request("/admin/setup", { headers: { cookie: auth.cookie } });
    expect(setup.status).toBe(404);
  });

  it("間違ったコードは 403 でセットアップ画面を再表示し、管理者にならない", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, USER);
    testApp.adminPolicy.setupCode();
    const res = await postForm(
      testApp.app,
      "/admin/setup",
      { _csrf: auth.csrfToken, code: "AAAA-AAAA-AAAA-AAAA-AAAA" },
      { cookie: auth.cookie },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("セットアップコードが違います");
    expect(testApp.adminPolicy.needsSetup()).toBe(true);
  });

  it("_csrf が無い POST は 403", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, USER);
    const code = testApp.adminPolicy.setupCode();
    const res = await postForm(testApp.app, "/admin/setup", { code }, { cookie: auth.cookie });
    expect(res.status).toBe(403);
    expect(testApp.adminPolicy.needsSetup()).toBe(true);
  });

  it("HAKONIWA_ADMIN_EMAILS があれば GET/POST /admin/setup は 404", async () => {
    const testApp = setupTestApp({ adminEmails: ["admin@example.com"] });
    const auth = await loginAs(testApp, USER);
    const get = await testApp.app.request("/admin/setup", { headers: { cookie: auth.cookie } });
    expect(get.status).toBe(404);
    const code = testApp.adminPolicy.setupCode();
    const post = await postForm(
      testApp.app,
      "/admin/setup",
      { _csrf: auth.csrfToken, code },
      { cookie: auth.cookie },
    );
    expect(post.status).toBe(404);
    expect(testApp.adminPolicy.storedEmails()).toEqual([]);
  });

  it("ゲーム未開始のトップ画面で管理者の初期設定へ案内する", async () => {
    const testApp = setupTestApp({ skipInit: true });
    const res = await testApp.app.request("/");
    const html = await res.text();
    expect(html).toContain("ゲームはまだ開始されていません");
    expect(html).toContain('href="/admin/setup"');
  });

  it("管理者がいればトップ画面に初期設定の案内を出さない", async () => {
    const testApp = setupTestApp({ skipInit: true, adminEmails: ["admin@example.com"] });
    const res = await testApp.app.request("/");
    expect(await res.text()).not.toContain('href="/admin/setup"');
  });
});

describe("管理画面「管理者」節 (/admin/admins)", () => {
  const ADMIN = { id: "admin1", name: "かんりしゃ", email: "admin@example.com" };

  it("環境変数の管理者は読み取り専用、追加した管理者は削除ボタン付きで表示する", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN.email] });
    testApp.adminPolicy.addEmail("stored@example.com");
    const auth = await loginAs(testApp, ADMIN);
    const res = await testApp.app.request("/admin", { headers: { cookie: auth.cookie } });
    const html = await res.text();
    expect(html).toContain("環境変数 (HAKONIWA_ADMIN_EMAILS)");
    expect(html).toContain('name="email" value="stored@example.com"');
    expect(html).not.toContain(`name="email" value="${ADMIN.email}"`);
  });

  it("管理者を追加すると、そのユーザーが管理画面に入れる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN.email] });
    const admin = await loginAs(testApp, ADMIN);
    const res = await postForm(
      testApp.app,
      "/admin/admins",
      { _csrf: admin.csrfToken, email: "New@Example.com" },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("管理者を追加しました。");

    const newUser = await loginAs(testApp, {
      id: "u2",
      name: "あたらしい",
      email: "new@example.com",
    });
    const adminPage = await testApp.app.request("/admin", { headers: { cookie: newUser.cookie } });
    expect(adminPage.status).toBe(200);
  });

  it("管理者以外は追加できない", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN.email] });
    const user = await loginAs(testApp, USER);
    const res = await postForm(
      testApp.app,
      "/admin/admins",
      { _csrf: user.csrfToken, email: USER.email },
      { cookie: user.cookie },
    );
    expect(res.status).toBe(403);
    expect(testApp.adminPolicy.storedEmails()).toEqual([]);
  });

  it("最後の管理者 (自分) は削除できない", async () => {
    const testApp = setupTestApp();
    testApp.adminPolicy.claimWithSetupCode(USER.email, testApp.adminPolicy.setupCode());
    const auth = await loginAs(testApp, USER);
    const res = await postForm(
      testApp.app,
      "/admin/admins/delete",
      { _csrf: auth.csrfToken, email: USER.email },
      { cookie: auth.cookie },
    );
    expect(res.status).toBe(400);
    expect(testApp.adminPolicy.storedEmails()).toEqual([USER.email]);
  });

  it("他の管理者がいれば削除できる", async () => {
    const testApp = setupTestApp({ adminEmails: [ADMIN.email] });
    testApp.adminPolicy.addEmail("stored@example.com");
    const admin = await loginAs(testApp, ADMIN);
    const res = await postForm(
      testApp.app,
      "/admin/admins/delete",
      { _csrf: admin.csrfToken, email: "stored@example.com" },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("管理者を削除しました。");
    expect(testApp.adminPolicy.storedEmails()).toEqual([]);
  });
});
