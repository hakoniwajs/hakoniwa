// worker.ts (Gateway) → ctx.exports.CachedPages → DO の経路の確認。
// Workers Cache そのもの (HIT/MISS) は @cloudflare/vitest-pool-workers では再現されないため、
// Gateway が CachedPages に渡す props・キャッシュキー・リクエストと、CachedPages・Gateway が
// 返すヘッダを確認する。
import { reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createIsland, fetchWorker, loginAsAdmin, recordingContext, startGame } from "./helpers.ts";

afterEach(async () => {
  await reset();
});

describe("Gateway → CachedPages", () => {
  it("OGP 画像は CachedPages を未ログインの props で呼び、Cookie を渡さない", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "いちごう");

    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1/islands/1/ogp.png?turn=1&utm_source=x",
      { headers: { cookie } },
      { ctx: recording },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // 画像は Gateway でも public のまま (ブラウザにもキャッシュさせてよい)。
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
    expect(res.headers.get("cache-tag")).toBeNull();

    expect(recording.calls).toHaveLength(1);
    const call = recording.calls[0];
    expect(call?.props).toEqual({ v: 1, viewer: "anonymous" });
    expect(call?.url).toBe("http://example.com/games/1/islands/1/ogp.png?turn=1");
    expect(call?.init?.cf).toEqual({ cacheKey: "/games/1/islands/1/ogp.png?turn=1" });
    expect(new Headers(call?.init?.headers).get("cookie")).toBeNull();
  });

  it("本物の ctx.exports でも OGP 画像が返る", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "にごう");

    const res = await fetchWorker("http://example.com/games/1/islands/1/ogp.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("CachedPages が再エクスポートされていなければ DO へ直接転送する", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "さんごう");

    const recording = recordingContext({ withCachedPages: false });
    const res = await fetchWorker("http://example.com/games/1/islands/1/ogp.png", undefined, {
      ctx: recording,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(recording.calls).toHaveLength(0);
  });

  it("対象外のパス (HTML・POST) は CachedPages を通らない", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    const recording = recordingContext();
    await fetchWorker(
      "http://example.com/games/1/my-island",
      { headers: { cookie } },
      { ctx: recording },
    );
    await fetchWorker(
      "http://example.com/games/1/islands",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: `name=x&_csrf=${encodeURIComponent(csrfToken)}`,
      },
      { ctx: recording },
    );
    expect(recording.calls).toHaveLength(0);
  });

  it("島が無い OGP 画像はエラー応答になり、ブラウザ向けには private, no-store", async () => {
    const res = await fetchWorker("http://example.com/games/1/islands/1/ogp.png");
    expect(res.status).not.toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("CachedPages (ctx.exports から直接呼ぶ)", () => {
  it("DO の応答を返し、Set-Cookie を含む応答は private, no-store にする", async () => {
    const cachedPages = (
      exports as unknown as Record<string, (opts: { props: unknown }) => Fetcher>
    )["CachedPages"];
    expect(cachedPages).toBeDefined();
    if (cachedPages === undefined) {
      return;
    }
    // /auth/dev (POST) は Set-Cookie を返す。CachedPages 経由でもキャッシュさせない形になる。
    const res = await cachedPages({ props: { v: 1, viewer: "anonymous" } }).fetch(
      "http://example.com/auth/dev",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=someone%40example.com",
        redirect: "manual",
      },
    );
    expect(res.headers.get("set-cookie")).not.toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
