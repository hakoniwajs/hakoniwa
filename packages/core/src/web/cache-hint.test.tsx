// web/cache-hint.ts (エッジのキャッシュの目安のヘッダ) の確認。
import { describe, expect, it } from "vitest";
import type { SeasonVM } from "../app/season.ts";
import type { GameHeaderVM } from "../app/view-models.ts";
import { CACHE_HINT_HEADER, CACHE_TAG_HINT_HEADER, pageCacheDirectives } from "./cache-hint.ts";
import { INITIAL_CLOCK, loginAs, postForm, setupTestApp } from "./test-helpers.ts";

const NOW = 1_000_000;

function game(isCurrent: boolean): GameHeaderVM {
  return { id: 1, name: "第 1 回", isCurrent } as GameHeaderVM;
}

function season(overrides: Partial<SeasonVM>): SeasonVM {
  return {
    gameId: 1,
    gameName: "第 1 回",
    status: "running",
    turn: 1,
    finalTurn: null,
    state: "running",
    startAt: NOW - 100,
    finishedAtTurn: null,
    nextTurnAt: NOW + 3600,
    unitTimeSec: 21600,
    ...overrides,
  };
}

describe("pageCacheDirectives", () => {
  it("過去のゲームは 1 日", () => {
    expect(
      pageCacheDirectives({
        game: game(false),
        season: season({ state: "finished", nextTurnAt: null }),
        now: NOW,
      }),
    ).toBe("max-age=86400");
  });

  it("進行中は次のターンまでの秒数 (上限 60) + stale-while-revalidate=60", () => {
    expect(pageCacheDirectives({ game: game(true), season: season({}), now: NOW })).toBe(
      "max-age=60, stale-while-revalidate=60",
    );
    expect(
      pageCacheDirectives({
        game: game(true),
        season: season({ nextTurnAt: NOW + 15 }),
        now: NOW,
      }),
    ).toBe("max-age=15, stale-while-revalidate=60");
  });

  it("次のターンの予定時刻を過ぎていればキャッシュさせない", () => {
    for (const nextTurnAt of [NOW, NOW - 1]) {
      expect(
        pageCacheDirectives({ game: game(true), season: season({ nextTurnAt }), now: NOW }),
      ).toBeUndefined();
    }
  });

  it("開始前はゲーム開始までの秒数 (上限 60)。開始時刻を過ぎていればキャッシュさせない", () => {
    const before = (startAt: number) =>
      season({ state: "before", turn: 0, startAt, nextTurnAt: null });
    expect(pageCacheDirectives({ game: game(true), season: before(NOW + 30), now: NOW })).toBe(
      "max-age=30, stale-while-revalidate=60",
    );
    expect(pageCacheDirectives({ game: game(true), season: before(NOW + 9999), now: NOW })).toBe(
      "max-age=60, stale-while-revalidate=60",
    );
    expect(
      pageCacheDirectives({ game: game(true), season: before(NOW), now: NOW }),
    ).toBeUndefined();
  });

  it("終了済み (現在のゲーム) は 60 秒", () => {
    expect(
      pageCacheDirectives({
        game: game(true),
        season: season({ state: "finished", status: "finished", nextTurnAt: null }),
        now: NOW,
      }),
    ).toBe("max-age=60, stale-while-revalidate=60");
  });
});

describe("応答の目安のヘッダ", () => {
  it("cacheHints が false (既定、Node 版) なら付けない", async () => {
    const testApp = setupTestApp();
    const res = await testApp.app.request("/games/1");
    expect(res.status).toBe(200);
    expect(res.headers.get(CACHE_HINT_HEADER)).toBeNull();
    expect(res.headers.get(CACHE_TAG_HINT_HEADER)).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("トップ・ゲーム一覧・観光画面に付ける。Cache-Control は private, no-store のまま", async () => {
    const testApp = setupTestApp({ cacheHints: true });
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

    const top = await testApp.app.request("/games/1");
    expect(top.headers.get(CACHE_HINT_HEADER)).toBe("max-age=60, stale-while-revalidate=60");
    expect(top.headers.get(CACHE_TAG_HINT_HEADER)).toBe("game-1");
    expect(top.headers.get("cache-control")).toBe("private, no-store");

    const games = await testApp.app.request("/games");
    expect(games.headers.get(CACHE_HINT_HEADER)).toBe("max-age=60, stale-while-revalidate=60");
    expect(games.headers.get(CACHE_TAG_HINT_HEADER)).toBe("games");

    const island = await testApp.app.request("/games/1/islands/1");
    expect(island.status).toBe(200);
    expect(island.headers.get(CACHE_HINT_HEADER)).toBe("max-age=60, stale-while-revalidate=60");
    expect(island.headers.get(CACHE_TAG_HINT_HEADER)).toBe("game-1,island-1-1");
    expect(island.headers.get("cache-control")).toBe("private, no-store");
  });

  it("エラー画面や POST には付けない", async () => {
    const testApp = setupTestApp({ cacheHints: true });
    const missing = await testApp.app.request("/games/1/islands/99");
    expect(missing.status).not.toBe(200);
    expect(missing.headers.get(CACHE_HINT_HEADER)).toBeNull();

    const owner = await loginAs(testApp, {
      id: "owner1",
      name: "しまぬし",
      email: "owner1@example.com",
    });
    const created = await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすとじま", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(created.headers.get(CACHE_HINT_HEADER)).toBeNull();
  });

  it("次のターンが近ければ残り秒数だけにする", async () => {
    const near = setupTestApp({ cacheHints: true });
    near.clock.set(INITIAL_CLOCK + 21600 - 10);
    const res = await near.app.request("/games/1");
    expect(res.headers.get(CACHE_HINT_HEADER)).toBe("max-age=10, stale-while-revalidate=60");
  });
});
