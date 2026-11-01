// X / Discord の連携ボタンが各社のブランドロゴ (公式 SVG) を表示することの確認を含む、
// GET /account のテスト。
import { describe, expect, it } from "vite-plus/test";
import { loginAs, setupTestApp } from "./test-helpers.ts";

describe("GET /account", () => {
  it("未ログインなら /login へ 302", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/account", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("X ログインが有効かつ未連携なら公式ロゴ画像 (x-logo.svg) を含む連携ボタンを表示する", async () => {
    const testApp = setupTestApp({ authMethodsConfigured: { x: true } });
    const auth = await loginAs(testApp, {
      id: "u1",
      name: "しまぬし",
      email: "u1@example.com",
    });
    const res = await testApp.app.request("/account", { headers: { cookie: auth.cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/account/link/x"');
    expect(html).toContain('src="/images/x-logo.svg"');
    expect(html).toContain("X で連携する");
  });

  it("Discord ログインが有効かつ未連携なら公式ロゴ画像 (discord-logo.svg) を含む連携ボタンを表示する", async () => {
    const testApp = setupTestApp({ authMethodsConfigured: { discord: true } });
    const auth = await loginAs(testApp, {
      id: "u1",
      name: "しまぬし",
      email: "u1@example.com",
    });
    const res = await testApp.app.request("/account", { headers: { cookie: auth.cookie } });
    const html = await res.text();
    expect(html).toContain('action="/account/link/discord"');
    expect(html).toContain('src="/images/discord-logo.svg"');
    expect(html).toContain("Discord で連携する");
  });

  it("連携済みの方法は追加ボタンを表示しない", async () => {
    const testApp = setupTestApp({ authMethodsConfigured: { x: true } });
    const auth = await loginAs(testApp, { id: "u1", name: "しまぬし", email: "u1@example.com" }, [
      { id: "acc1", providerId: "twitter" },
    ]);
    const res = await testApp.app.request("/account", { headers: { cookie: auth.cookie } });
    const html = await res.text();
    expect(html).not.toContain('action="/account/link/x"');
    expect(html).not.toContain("X で連携する");
    // 連携中一覧には表示される。
    expect(html).toContain("X (Twitter)");
  });
});
