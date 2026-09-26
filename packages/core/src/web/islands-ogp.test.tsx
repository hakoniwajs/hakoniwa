// tmp/17-ogp.md 「テスト」節: web 層 (`/islands/:id/ogp.png` と `/islands/:id` の OGP メタタグ)。
// tmp/18-games.md 対応で `/games/:gameId/islands/:id/ogp.png` に移った。
import { describe, expect, it } from "vitest";
import { defaultSiteSettings } from "../app/site-settings.ts";
import { loginAs, postForm, setupTestApp } from "./test-helpers.ts";
import type { TestApp } from "./test-helpers.ts";

async function createIsland(testApp: TestApp, name = "てすとじま") {
  const owner = await loginAs(testApp, {
    id: "owner1",
    name: "しまぬし",
    email: "owner1@example.com",
  });
  await postForm(
    testApp.app,
    "/games/1/islands",
    { name, _csrf: owner.csrfToken },
    { cookie: owner.cookie },
  );
  return owner;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

describe("GET /games/:gameId/islands/:id/ogp.png", () => {
  it("image/png と Cache-Control を返し、800x420 の PNG になる", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp);
    const res = await testApp.app.request("/games/1/islands/1/ogp.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("cache-tag")).toBe("island-1");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = bytes.subarray(16, 16 + 13);
    expect(readUint32BE(ihdr, 0)).toBe(800);
    expect(readUint32BE(ihdr, 4)).toBe(420);
  });

  it("?turn= クエリが付いていても同じ画像を返す (キー違いのみ)", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp);
    const res = await testApp.app.request("/games/1/islands/1/ogp.png?turn=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("存在しない島は 404", async () => {
    const testApp = setupTestApp();
    const res = await testApp.app.request("/games/1/islands/999/ogp.png");
    expect(res.status).toBe(404);
  });

  it("存在しないゲームは 404", async () => {
    const testApp = setupTestApp();
    const res = await testApp.app.request("/games/999/islands/1/ogp.png");
    expect(res.status).toBe(404);
  });

  it("認証なしで取得できる (誰でも同じ画像)", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp);
    const res = await testApp.app.request("/games/1/islands/1/ogp.png");
    expect(res.status).toBe(200);
  });

  it("旧 URL (/islands/:id/ogp.png) は現在のゲームへ 302 (クエリも保持)", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp);
    const res = await testApp.app.request("/islands/1/ogp.png?turn=1", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/games/1/islands/1/ogp.png?turn=1");
  });
});

describe("GET /games/:gameId/islands/:id の OGP メタタグ", () => {
  it("og:image / og:url が絶対 URL でゲーム ID 入り、?turn= を含み、og:title/description を含む", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp, "てすとじま");
    const res = await testApp.app.request("/games/1/islands/1");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('<meta property="og:type" content="website"/>');
    expect(html).toContain(
      `<meta property="og:title" content="てすとじま島 - ${defaultSiteSettings.title}"/>`,
    );
    expect(html).toContain("ターン1 / 人口");
    expect(html).toContain(
      '<meta property="og:image" content="http://localhost:5173/games/1/islands/1/ogp.png?turn=1"/>',
    );
    expect(html).toContain('<meta property="og:image:width" content="800"/>');
    expect(html).toContain('<meta property="og:image:height" content="420"/>');
    expect(html).toContain(
      '<meta property="og:url" content="http://localhost:5173/games/1/islands/1"/>',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
  });

  it("HAKONIWA_BASE_URL (config.auth.baseUrl) が無い場合はリクエストのオリジンを使う", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp);
    const { baseUrl: _baseUrl, ...authWithoutBaseUrl } = testApp.config.auth;
    testApp.config.auth = authWithoutBaseUrl;
    const res = await testApp.app.request("https://example.com/games/1/islands/1");
    const html = await res.text();
    expect(html).toContain('content="https://example.com/games/1/islands/1/ogp.png?turn=1"');
    expect(html).toContain('content="https://example.com/games/1/islands/1"');
  });
});
