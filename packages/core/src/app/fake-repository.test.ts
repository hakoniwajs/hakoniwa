import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../core/config.ts";
import { estimate, makeNewIsland } from "../core/island.ts";
import { createSeededRng } from "../core/rng.ts";
import { FakeGameRepository } from "./fake-repository.ts";
import type { CreateGameInput } from "./ports.ts";

function makeIsland(id: number, name: string) {
  const island = makeNewIsland(defaultConfig, createSeededRng(id), {
    id,
    name,
    ownerUserId: `owner-${id}`,
  });
  estimate(island);
  return island;
}

/** テスト用の `createGame` 入力の既定値。 */
function gameInput(overrides: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    name: "第 1 回",
    startAt: 0,
    finalTurn: null,
    unitTimeSec: defaultConfig.unitTimeSec,
    ...overrides,
  };
}

describe("FakeGameRepository", () => {
  it("初期化前は isInitialized が false", () => {
    const repo = new FakeGameRepository();
    expect(repo.isInitialized()).toBe(false);
  });

  it("createGame でゲームが作られ isInitialized が true になる", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    expect(repo.isInitialized()).toBe(true);
    expect(gameId).toBe(1);
    const meta = repo.getMeta(gameId);
    // tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: 新しいゲームは
    // turn=0 (開始前)、firstTurn=0 で作られる。
    expect(meta.turn).toBe(0);
    expect(meta.firstTurn).toBe(0);
    expect(meta.nextIslandId).toBe(1);
    expect(meta.status).toBe("running");
  });

  it("insertIsland は rank の位置に挿入し、listIslandSummaries は rank 順", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput({ startAt: 0 }), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    repo.insertIsland(gameId, makeIsland(2, "島2"), 1);

    const summaries = repo.listIslandSummaries(gameId);
    expect(summaries.map((s) => s.id)).toEqual([1, 2]);
  });

  it("findIsland はクローンを返す (呼び出し側の変更が反映されない)", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);

    const island = repo.findIsland(gameId, 1);
    if (island === undefined) throw new Error("not found");
    island.comment = "書き換えてみる";

    const reloaded = repo.findIsland(gameId, 1);
    expect(reloaded?.comment).not.toBe("書き換えてみる");
  });

  it("updateIsland で変更が反映される", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);

    const island = repo.findIsland(gameId, 1);
    if (island === undefined) throw new Error("not found");
    island.comment = "更新";
    repo.updateIsland(gameId, island);

    expect(repo.findIsland(gameId, 1)?.comment).toBe("更新");
  });

  it("replaceAllIslands は渡された順に rank を振り直し、含まれない島を削除する", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    const island1 = makeIsland(1, "島1");
    const island2 = makeIsland(2, "島2");
    repo.insertIsland(gameId, island1, 0);
    repo.insertIsland(gameId, island2, 1);

    // island2 が2位、island1 は死滅として除外。
    repo.replaceAllIslands(gameId, [island2]);

    const summaries = repo.listIslandSummaries(gameId);
    expect(summaries.map((s) => s.id)).toEqual([2]);
    expect(repo.findIsland(gameId, 1)).toBeUndefined();
  });

  it("tryBumpTurn は expectedTurn が一致する時のみ成功する", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    const meta = repo.getMeta(gameId);

    // 新しいゲームは turn=0 (tmp/16-season.md「開始前の状態 = ターン 0」節) で作られるため、
    // expectedTurn が一致しない 1 は失敗する。
    expect(
      repo.tryBumpTurn(gameId, 1, {
        ...meta,
        turn: 2,
        lastTime: 100,
      }),
    ).toBe(false);
    expect(
      repo.tryBumpTurn(gameId, 0, {
        ...meta,
        turn: 1,
        lastTime: 100,
      }),
    ).toBe(true);
    expect(repo.getMeta(gameId).turn).toBe(1);
  });

  it("listLogs は sinceTurn / islandId / includeSecretFor で絞り込む", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: false, islandId: 1, targetId: 0, html: "通常1", seq: 0 },
      { turn: 1, secret: true, islandId: 1, targetId: 0, html: "機密1", seq: 1 },
      { turn: 1, secret: false, islandId: 2, targetId: 0, html: "通常2", seq: 0 },
      { turn: 0, secret: false, islandId: 1, targetId: 0, html: "古い", seq: 0 },
    ]);

    const visitor = repo.listLogs(gameId, { sinceTurn: 1, islandId: 1 });
    expect(visitor.map((l) => l.html)).toEqual(["通常1"]);

    const owner = repo.listLogs(gameId, { sinceTurn: 1, islandId: 1, includeSecretFor: 1 });
    expect(owner.map((l) => l.html).sort()).toEqual(["機密1", "通常1"].sort());
  });

  it("deleteLogsBefore は指定 turn 未満を削除する", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: false, islandId: 0, targetId: 0, html: "a", seq: 0 },
      { turn: 3, secret: false, islandId: 0, targetId: 0, html: "b", seq: 0 },
    ]);

    repo.deleteLogsBefore(gameId, 3);

    expect(repo.listLogs(gameId, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["b"]);
  });

  it("trimHistory は新しい順に keep 件を残す", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.appendHistory(gameId, [
      { turn: 1, html: "a" },
      { turn: 2, html: "b" },
      { turn: 3, html: "c" },
    ]);

    repo.trimHistory(gameId, 2);

    expect(repo.listHistory(gameId, 10).map((h) => h.html)).toEqual(["c", "b"]);
  });

  it("reset は全データを削除する", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);

    repo.reset();

    expect(repo.isInitialized()).toBe(false);
    expect(repo.listGames()).toEqual([]);
    // reset 後は既存の gameId に対する問い合わせも空を返す (throw しない)。
    expect(repo.listIslandSummaries(gameId)).toEqual([]);
  });
});

// tmp/18-games.md「複数ゲーム (過去のゲームの保存)」節: ゲームごとにデータが独立していること。
describe("FakeGameRepository: 複数ゲーム", () => {
  it("getCurrentGameId は MAX(id) (最後に作ったゲーム) を返す", () => {
    const repo = new FakeGameRepository();
    expect(repo.getCurrentGameId()).toBeUndefined();

    const game1 = repo.createGame(gameInput({ name: "第 1 回" }), 0);
    expect(repo.getCurrentGameId()).toBe(game1);

    repo.finishGame(game1, 100);
    const game2 = repo.createGame(gameInput({ name: "第 2 回" }), 100);
    expect(repo.getCurrentGameId()).toBe(game2);
    expect(game2).toBeGreaterThan(game1);
  });

  it("listGames は新しい順に GameSummary (islandCount 含む) を返す", () => {
    const repo = new FakeGameRepository();
    const game1 = repo.createGame(gameInput({ name: "第 1 回" }), 0);
    repo.insertIsland(game1, makeIsland(1, "島1"), 0);
    repo.finishGame(game1, 100);
    const game2 = repo.createGame(gameInput({ name: "第 2 回" }), 100);
    repo.insertIsland(game2, makeIsland(1, "新しい島1"), 0);
    repo.insertIsland(game2, makeIsland(2, "新しい島2"), 1);

    const games = repo.listGames();
    expect(games.map((g) => g.id)).toEqual([game2, game1]);
    expect(games.find((g) => g.id === game1)).toMatchObject({
      name: "第 1 回",
      status: "finished",
      islandCount: 1,
    });
    expect(games.find((g) => g.id === game2)).toMatchObject({
      name: "第 2 回",
      status: "running",
      islandCount: 2,
    });
  });

  it("島・ログ・履歴はゲームごとに独立し、互いに混ざらない", () => {
    const repo = new FakeGameRepository();
    const game1 = repo.createGame(gameInput({ name: "第 1 回" }), 0);
    repo.insertIsland(game1, makeIsland(1, "旧島"), 0);
    repo.appendLogs(game1, [
      { turn: 1, secret: false, islandId: 1, targetId: 0, html: "旧ログ", seq: 0 },
    ]);
    repo.appendHistory(game1, [{ turn: 1, html: "旧履歴" }]);
    repo.finishGame(game1, 100);

    const game2 = repo.createGame(gameInput({ name: "第 2 回" }), 100);
    repo.appendLogs(game2, [
      { turn: 1, secret: false, islandId: 1, targetId: 0, html: "新ログ", seq: 0 },
    ]);
    repo.appendHistory(game2, [{ turn: 1, html: "新履歴" }]);

    // game2 には島がまだ無いのに game1 の島が漏れてこないこと。
    expect(repo.listIslandSummaries(game2)).toEqual([]);
    expect(repo.findIsland(game2, 1)).toBeUndefined();
    expect(repo.findIsland(game1, 1)?.name).toBe("旧島");

    expect(repo.listLogs(game1, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["旧ログ"]);
    expect(repo.listLogs(game2, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["新ログ"]);

    expect(repo.listHistory(game1, 10).map((h) => h.html)).toEqual(["旧履歴"]);
    expect(repo.listHistory(game2, 10).map((h) => h.html)).toEqual(["新履歴"]);
  });

  it("島 ID はゲームごとに独立して 1 から採番できる (同じ id の島が別ゲームに共存できる)", () => {
    const repo = new FakeGameRepository();
    const game1 = repo.createGame(gameInput({ name: "第 1 回" }), 0);
    repo.insertIsland(game1, makeIsland(1, "game1-島1"), 0);
    repo.finishGame(game1, 100);

    const game2 = repo.createGame(gameInput({ name: "第 2 回" }), 100);
    // game2 でも id=1 から改めて島を作れる (game1 の id=1 とは別物として扱われる)。
    repo.insertIsland(game2, makeIsland(1, "game2-島1"), 0);

    const islandInGame1 = repo.findIsland(game1, 1);
    const islandInGame2 = repo.findIsland(game2, 1);
    expect(islandInGame1?.name).toBe("game1-島1");
    expect(islandInGame2?.name).toBe("game2-島1");
    expect(repo.listIslandSummaries(game1).map((s) => s.id)).toEqual([1]);
    expect(repo.listIslandSummaries(game2).map((s) => s.id)).toEqual([1]);
  });

  it("reset は全ゲームを削除する", () => {
    const repo = new FakeGameRepository();
    const game1 = repo.createGame(gameInput({ name: "第 1 回" }), 0);
    repo.finishGame(game1, 100);
    repo.createGame(gameInput({ name: "第 2 回" }), 100);
    expect(repo.listGames()).toHaveLength(2);

    repo.reset();

    expect(repo.isInitialized()).toBe(false);
    expect(repo.listGames()).toEqual([]);
    expect(repo.getCurrentGameId()).toBeUndefined();
  });
});

// tmp/19-abandon.md (島の放棄と新しい島の発見)。
describe("FakeGameRepository: 島の放棄", () => {
  it("findIslandByOwner は放棄されていない島だけを返す", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    const island = makeIsland(1, "島1");
    repo.insertIsland(gameId, island, 0);
    expect(repo.findIslandByOwner(gameId, "owner-1")?.id).toBe(1);

    const abandoned = { ...island, abandonedAt: 12345 };
    repo.updateIsland(gameId, abandoned);
    expect(repo.findIslandByOwner(gameId, "owner-1")).toBeUndefined();
  });

  it("放棄後、同じ owner_user_id で新しい島を insert できる (部分インデックス相当)", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    const island1 = makeIsland(1, "島1");
    repo.insertIsland(gameId, island1, 0);
    repo.updateIsland(gameId, { ...island1, abandonedAt: 12345 });

    const island2 = makeIsland(2, "島2");
    island2.ownerUserId = island1.ownerUserId;
    expect(() => repo.insertIsland(gameId, island2, 1)).not.toThrow();
    expect(repo.findIslandByOwner(gameId, island1.ownerUserId)?.id).toBe(2);
  });

  it("countAbandonments / recordAbandonment: (gameId, userId) ごとにカウントする", () => {
    const repo = new FakeGameRepository();
    const gameId = repo.createGame(gameInput(), 0);
    expect(repo.countAbandonments(gameId, "u1")).toBe(0);

    repo.recordAbandonment(gameId, "u1", 1, "島1", 100);
    expect(repo.countAbandonments(gameId, "u1")).toBe(1);
    expect(repo.countAbandonments(gameId, "u2")).toBe(0);

    repo.recordAbandonment(gameId, "u1", 2, "島2", 200);
    repo.recordAbandonment(gameId, "u2", 3, "島3", 300);
    expect(repo.countAbandonments(gameId, "u1")).toBe(2);
    expect(repo.countAbandonments(gameId, "u2")).toBe(1);
  });
});
