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
  it("過去のゲームは immutable (トップ・観光・開発画面とも)", () => {
    for (const page of ["top", "island", "owner"] as const) {
      expect(
        pageCacheDirectives({
          page,
          game: game(false),
          season: season({ state: "finished", nextTurnAt: null }),
          now: NOW,
        }),
      ).toBe("max-age=31536000, immutable");
    }
  });

  it("進行中は次のターンまでの秒数 (上限 60) + stale-while-revalidate=60", () => {
    expect(
      pageCacheDirectives({ page: "top", game: game(true), season: season({}), now: NOW }),
    ).toBe("max-age=60, stale-while-revalidate=60");
    expect(
      pageCacheDirectives({
        page: "top",
        game: game(true),
        season: season({ nextTurnAt: NOW + 15 }),
        now: NOW,
      }),
    ).toBe("max-age=15, stale-while-revalidate=60");
  });

  it("次のターンの予定時刻を過ぎていればキャッシュさせない", () => {
    for (const nextTurnAt of [NOW, NOW - 1]) {
      expect(
        pageCacheDirectives({
          page: "top",
          game: game(true),
          season: season({ nextTurnAt }),
          now: NOW,
        }),
      ).toBeUndefined();
    }
  });

  it("開始前はゲーム開始までの秒数 (上限 60)。開始時刻を過ぎていればキャッシュさせない", () => {
    const before = (startAt: number) =>
      season({ state: "before", turn: 0, startAt, nextTurnAt: null });
    expect(
      pageCacheDirectives({ page: "top", game: game(true), season: before(NOW + 30), now: NOW }),
    ).toBe("max-age=30, stale-while-revalidate=60");
    expect(
      pageCacheDirectives({ page: "top", game: game(true), season: before(NOW + 9999), now: NOW }),
    ).toBe("max-age=60, stale-while-revalidate=60");
    expect(
      pageCacheDirectives({ page: "top", game: game(true), season: before(NOW), now: NOW }),
    ).toBeUndefined();
  });

  it("終了済み (現在のゲーム) のトップは immutable、観光・開発画面は 60 秒 (記帳が入りうる)", () => {
    const finished = season({ state: "finished", status: "finished", nextTurnAt: null });
    expect(pageCacheDirectives({ page: "top", game: game(true), season: finished, now: NOW })).toBe(
      "max-age=31536000, immutable",
    );
    for (const page of ["island", "owner"] as const) {
      expect(pageCacheDirectives({ page, game: game(true), season: finished, now: NOW })).toBe(
        "max-age=60, stale-while-revalidate=60",
      );
    }
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

describe("管理操作のあとのキャッシュの purge (WebDeps.cachePurger)", () => {
  it("サイト設定・ゲームの終了/開始・データの削除のあとに呼ぶ。それ以外の操作では呼ばない", async () => {
    const reasons: string[] = [];
    const testApp = setupTestApp({
      adminEmails: ["admin@example.com"],
      cachePurger: {
        purgeAll: async (reason) => {
          reasons.push(reason);
        },
      },
    });
    const admin = await loginAs(testApp, {
      id: "admin1",
      name: "かんりしゃ",
      email: "admin@example.com",
    });
    const post = (path: string, fields: Record<string, string> = {}) =>
      postForm(testApp.app, path, { _csrf: admin.csrfToken, ...fields }, { cookie: admin.cookie });

    expect((await post("/admin/site-settings", { title: "しま", timezone: "UTC" })).status).toBe(
      200,
    );
    expect((await post("/admin/turn")).status).toBe(200);
    expect((await post("/admin/games/current/finish", { confirm: "on" })).status).toBe(200);
    expect((await post("/admin/games")).status).toBe(200);
    expect((await post("/admin/reset")).status).toBe(200);
    expect(reasons).toEqual(["site-settings", "finish-game", "start-game", "reset"]);

    // 失敗した操作 (進行中のゲームがあるのに開始) では呼ばない。
    reasons.length = 0;
    await post("/admin/games");
    await post("/admin/games");
    expect(reasons).toEqual(["start-game"]);
  });
});
