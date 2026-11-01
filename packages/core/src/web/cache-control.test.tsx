// tmp/17-ogp.md 「キャッシュ (Workers Cache)」節: Workers Cache は Cache-Control の無い応答も
// ヒューリスティックにキャッシュしてしまう (Cookie 付きリクエストもバイパスしない) ため、
// createApp の defaultCacheControlMiddleware がすべての応答に既定 `private, no-store` を
// 付けることを確認する (ルートが明示した Cache-Control はそちらが優先されることは
// islands-ogp.test.tsx の OGP 画像テストで確認済み)。
import { describe, expect, it } from "vite-plus/test";
import { loginAs, postForm, setupTestApp } from "./test-helpers.ts";

describe("既定の Cache-Control (private, no-store)", () => {
  it("トップページ", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("観光画面 (/games/:gameId/islands/:id)", async () => {
    const testApp = setupTestApp();
    const owner = await loginAs(testApp, {
      id: "owner1",
      name: "しまぬし",
      email: "owner1@example.com",
    });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすとじま", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    const res = await testApp.app.request("/games/1/islands/1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("/login", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/login");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("/api/auth/* (better-auth へ委譲する経路。FakeAuth はエラーになるが、その応答にも既定が付く)", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/api/auth/get-session");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("エラー画面 (onError 経由) にも既定が付く", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/1/islands/999");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
