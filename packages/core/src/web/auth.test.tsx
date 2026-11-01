// X / Discord のログインボタンが各社のブランドロゴ (公式 SVG) を表示することの確認を含む、
// GET /login のテスト。
import { describe, expect, it } from "vite-plus/test";
import { setupTestApp } from "./test-helpers.ts";

describe("GET /login", () => {
  it("X / Discord とも未設定なら SNS ログインの見出しやボタンを表示しない", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("SNS アカウントでログイン");
    expect(html).not.toContain("/images/x-logo.svg");
    expect(html).not.toContain("/images/discord-logo.svg");
  });

  it("X ログインが有効なら公式ロゴ画像 (x-logo.svg) を含むボタンを /auth/x へのリンクとして表示する", async () => {
    const { app } = setupTestApp({ authMethodsConfigured: { x: true } });
    const res = await app.request("/login");
    const html = await res.text();
    expect(html).toContain('href="/auth/x"');
    expect(html).toContain('src="/images/x-logo.svg"');
    expect(html).toContain("X でログイン");
  });

  it("Discord ログインが有効なら公式ロゴ画像 (discord-logo.svg) を含むボタンを /auth/discord へのリンクとして表示する", async () => {
    const { app } = setupTestApp({ authMethodsConfigured: { discord: true } });
    const res = await app.request("/login");
    const html = await res.text();
    expect(html).toContain('href="/auth/discord"');
    expect(html).toContain('src="/images/discord-logo.svg"');
    expect(html).toContain("Discord でログイン");
  });

  it("管理画面で無効化されたログイン方法はボタンごと表示しない", async () => {
    const testApp = setupTestApp({ authMethodsConfigured: { x: true, discord: true } });
    testApp.adminService.setAuthMethods({ x: false, discord: true, email: true });
    const res = await testApp.app.request("/login");
    const html = await res.text();
    expect(html).not.toContain("/images/x-logo.svg");
    expect(html).toContain("/images/discord-logo.svg");
  });
});
