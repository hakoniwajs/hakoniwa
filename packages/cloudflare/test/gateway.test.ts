// worker.ts (Gateway) → ctx.exports.CachedPages → DO の経路の確認。
// Workers Cache そのもの (HIT/MISS) は @cloudflare/vitest-pool-workers では再現されないため、
// Gateway が CachedPages に渡す props・キャッシュキー・リクエストと、CachedPages・Gateway が
// 返すヘッダを確認する。
import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import { clearAuthSecretMemo } from "../src/worker.ts";
import {
  createIsland,
  fetchWorker,
  loginAsAdmin,
  mainGameStub,
  recordingContext,
  startGame,
} from "./helpers.ts";

function cachedPages(props: unknown): Fetcher {
  const loopback = (exports as unknown as Record<string, (opts: { props: unknown }) => Fetcher>)[
    "CachedPages"
  ];
  if (loopback === undefined) {
    throw new Error("CachedPages is not exported");
  }
  return loopback({ props });
}

const ANONYMOUS = { v: 1, viewer: "anonymous", origin: "http://example.com" };

afterEach(async () => {
  await reset();
  clearAuthSecretMemo();
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

  it("未ログインのトップ・観光・ゲーム一覧は CachedPages 経由で、ブラウザには private, no-store", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "よんごう");

    for (const path of ["/games", "/games/1", "/games/1/islands/1"]) {
      const recording = recordingContext();
      const res = await fetchWorker(
        `http://example.com${path}?utm_source=x`,
        { headers: { cookie: "theme=dark" } },
        { ctx: recording },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("cache-tag")).toBeNull();
      expect(res.headers.get("x-hakoniwa-cache-control")).toBeNull();
      expect(res.headers.get("x-hakoniwa-route")).toBe("cached");
      const html = await res.text();
      // 未ログインとして描画されている (ログインのリンクがあり、自分の島へのリンクが無い)。
      expect(html).toContain('href="/login"');
      expect(html).not.toContain('href="/my-island"');

      expect(recording.calls).toHaveLength(1);
      const call = recording.calls[0];
      expect(call?.props).toEqual(ANONYMOUS);
      expect(call?.url).toBe(`http://example.com${path}`);
      expect(call?.init?.cf).toEqual({ cacheKey: path });
      expect(new Headers(call?.init?.headers).get("cookie")).toBeNull();
    }
  });

  it("ログイン中 (better-auth の Cookie あり) の HTML は DO へ直接転送する", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1",
      { headers: { cookie } },
      {
        ctx: recording,
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-hakoniwa-route")).toBe("direct");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // DO が付けたキャッシュの目安 (内部ヘッダ) はブラウザへ返さない。
    expect(res.headers.get("x-hakoniwa-cache-control")).toBeNull();
    expect(res.headers.get("x-hakoniwa-cache-tag")).toBeNull();
    expect(await res.text()).toContain('href="/my-island"');
    expect(recording.calls).toHaveLength(0);
  });

  it("既存のデプロイに KV (SNAPSHOT) のバインディングや TTL の環境変数が残っていても動く", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    const legacyEnv = {
      ...env,
      SNAPSHOT: { get: () => Promise.reject(new Error("KV は使わない")) },
      HAKONIWA_SNAPSHOT_TTL_SEC: "not-a-number",
      HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC: "-1",
    } as unknown as Env;
    const res = await fetchWorker("http://example.com/games/1", undefined, { env: legacyEnv });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("諸島の状況");
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
  it("進行中のゲームのページは public + 次のターンまで (上限 60 秒) + stale-while-revalidate", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await mainGameStub().checkTurn();
    await createIsland(cookie, csrfToken, 1, "ごごう");

    const top = await cachedPages(ANONYMOUS).fetch("http://example.com/games/1");
    expect(top.status).toBe(200);
    expect(top.headers.get("cache-control")).toMatch(
      /^public, max-age=\d+, stale-while-revalidate=60$/,
    );
    expect(top.headers.get("cache-tag")).toBe("game-1");
    expect(top.headers.get("x-hakoniwa-cache-control")).toBeNull();
    // 残り時間は HTML に埋め込まない (キャッシュした HTML が古くならないように)。
    const html = await top.text();
    expect(html).toContain("data-remaining-until=");
    expect(html).not.toContain("(あと ");

    const island = await cachedPages(ANONYMOUS).fetch("http://example.com/games/1/islands/1");
    expect(island.headers.get("cache-tag")).toBe("game-1,island-1-1");

    const games = await cachedPages(ANONYMOUS).fetch("http://example.com/games");
    expect(games.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=60",
    );
    expect(games.headers.get("cache-tag")).toBe("games");
  });

  it("過去のゲームのページは immutable。存在しないページはキャッシュさせない", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    const stub = mainGameStub();
    await stub.fetch("http://example.com/admin/games/current/finish", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `confirm=on&_csrf=${encodeURIComponent(csrfToken)}`,
    });
    await startGame(cookie, csrfToken);

    const past = await cachedPages(ANONYMOUS).fetch("http://example.com/games/1");
    expect(past.status).toBe(200);
    expect(past.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const missing = await cachedPages(ANONYMOUS).fetch("http://example.com/games/99");
    expect(missing.status).not.toBe(200);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
  });

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
