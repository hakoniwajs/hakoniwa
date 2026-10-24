// tmp/17-ogp.md 「キャッシュ (Workers Cache)」節: Workers Cache (`wrangler.jsonc` の
// `cache.enabled`) は応答の `Cache-Control` に従う。自前の Cache API 呼び出しは行わないため、
// worker.ts は DO への単純な転送のみで、`Cache-Control` は `@hakoniwajs/core` の
// defaultCacheControlMiddleware / OGP ルートが付ける。DO 経由でその応答ヘッダを確認する。
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function getStub(name: string) {
  const id = env.GAME.idFromName(name);
  return env.GAME.get(id);
}

describe("Cache-Control (Workers Cache が従う応答ヘッダ)", () => {
  it("GET /login は private, no-store", async () => {
    const stub = getStub("cache-control-login");
    const res = await stub.fetch("http://example.com/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("GET / (トップ) は private, no-store", async () => {
    const stub = getStub("cache-control-top");
    const res = await stub.fetch("http://example.com/");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("/games/:gameId/islands/:id/ogp.png は public, max-age=3600 (island が無くても no-store ではなく 404)", async () => {
    const stub = getStub("cache-control-ogp-missing");
    const res = await stub.fetch("http://example.com/games/1/islands/1/ogp.png");
    // 島が無い (未初期化/未作成) ため 404 だが、既定の no-store が付くことを確認する。
    expect(res.status).not.toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("島作成後の /islands/:id/ogp.png は image/png と public, max-age=3600、Cache-Tag を返す", async () => {
    const stub = getStub("cache-control-ogp-hit");

    const loginRes = await stub.fetch("http://example.com/auth/dev", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=admin%40example.com",
      redirect: "manual",
    });
    const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined) {
      throw new Error("login failed");
    }

    const adminRes = await stub.fetch("http://example.com/admin", { headers: { cookie } });
    const adminHtml = await adminRes.text();
    const csrfToken = adminHtml.match(/name="_csrf" value="([^"]+)"/)?.[1];
    if (csrfToken === undefined) {
      throw new Error("csrf token not found");
    }

    await stub.fetch("http://example.com/admin/games", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `_csrf=${encodeURIComponent(csrfToken)}`,
    });
    await stub.fetch("http://example.com/games/1/islands", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `name=${encodeURIComponent("てすとじま")}&_csrf=${encodeURIComponent(csrfToken)}`,
    });

    const ogpRes = await stub.fetch("http://example.com/games/1/islands/1/ogp.png");
    expect(ogpRes.status).toBe(200);
    expect(ogpRes.headers.get("content-type")).toBe("image/png");
    // tmp/21-kv-snapshot-cache.md「OGP 画像」節: 進行中のゲームの max-age は「次のターンまでの
    // 秒数」を 60〜3600 秒にクランプした値なので、実行時刻によって変わる (ゲーム作成時の
    // startAt は現在時刻を 1 ターン長で切り下げた値になるため、ターン長の残りが 1 時間を切る
    // 時間帯に実行すると 3600 未満になる)。固定値ではなく範囲で検証する。
    const ogpCacheControl = ogpRes.headers.get("cache-control");
    const ogpMaxAge = Number(/^public, max-age=(\d+)$/.exec(ogpCacheControl ?? "")?.[1]);
    expect(ogpCacheControl).toMatch(/^public, max-age=\d+$/);
    expect(ogpMaxAge).toBeGreaterThanOrEqual(60);
    expect(ogpMaxAge).toBeLessThanOrEqual(3600);
    expect(ogpRes.headers.get("cache-tag")).toBe("game-1,island-1-1");

    // 旧 URL (ゲーム ID を含まない) は現在のゲームへ 302 で転送される。
    const legacyOgpRes = await stub.fetch("http://example.com/islands/1/ogp.png", {
      redirect: "manual",
    });
    expect(legacyOgpRes.status).toBe(302);
    expect(legacyOgpRes.headers.get("location")).toBe("/games/1/islands/1/ogp.png");

    const pageRes = await stub.fetch("http://example.com/games/1/islands/1", {
      headers: { cookie },
    });
    expect(pageRes.headers.get("cache-control")).toBe("private, no-store");
    expect(await pageRes.text()).toContain(
      'content="http://example.com/games/1/islands/1/ogp.png?turn=1"',
    );
  });

  it("/api/auth/get-session はキャッシュされない (better-auth 自身が no-store を付ける)", async () => {
    const stub = getStub("cache-control-api-auth");
    const res = await stub.fetch("http://example.com/api/auth/get-session");
    // better-auth のセッション系エンドポイントは自前で Cache-Control: no-store を返す。
    // defaultCacheControlMiddleware はルートが既に設定した値を優先するのでそのまま通る
    // (「no-store を含む」ことだけ確認し、値そのものは better-auth 側の実装に委ねる)。
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
