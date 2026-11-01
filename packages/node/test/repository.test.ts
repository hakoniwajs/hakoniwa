// 04-database.md / fake-repository.test.ts と同等の観点、および tmp/18-games.md (複数ゲーム) の
// 観点を実 SQLite (:memory:) で検証する。
import {
  createSeededRng,
  estimate,
  FakeGameRepository,
  makeNewIsland,
  migrate,
  SqliteGameRepository,
  defaultConfig,
} from "@hakoniwajs/core";
import type { CreateGameInput, GameRepository, Island } from "@hakoniwajs/core";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { NodeSqliteDriver } from "../src/driver.ts";

function makeIsland(id: number, name: string): Island {
  const island = makeNewIsland(defaultConfig, createSeededRng(id), {
    id,
    name,
    ownerUserId: `owner-${id}`,
  });
  estimate(island);
  return island;
}

function createRepo(): { driver: NodeSqliteDriver; repo: SqliteGameRepository } {
  const driver = new NodeSqliteDriver(":memory:");
  migrate(driver);
  const repo = new SqliteGameRepository(driver, {
    islandSize: defaultConfig.islandSize,
    commandMax: defaultConfig.commandMax,
  });
  return { driver, repo };
}

/** `createGame` の既定値ヘルパ。 */
function newGameInput(overrides: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    name: "第 1 回",
    startAt: 0,
    finalTurn: null,
    unitTimeSec: defaultConfig.unitTimeSec,
    ...overrides,
  };
}

describe("SqliteGameRepository", () => {
  let driver: NodeSqliteDriver;
  let repo: SqliteGameRepository;
  let gameId: number;

  beforeEach(() => {
    ({ driver, repo } = createRepo());
  });

  it("初期化前は isInitialized が false、createGame 後は true", () => {
    expect(repo.isInitialized()).toBe(false);
    gameId = repo.createGame(newGameInput(), 0);
    expect(repo.isInitialized()).toBe(true);
    expect(repo.getCurrentGameId()).toBe(gameId);
    const meta = repo.getMeta(gameId);
    // tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: 新しいゲームは turn=0。
    expect(meta.turn).toBe(0);
    expect(meta.firstTurn).toBe(0);
    expect(meta.lastTime).toBe(0);
    expect(meta.nextIslandId).toBe(1);
    expect(meta.finalTurn).toBeNull();
    expect(meta.startAt).toBe(0);
    expect(meta.unitTimeSec).toBe(defaultConfig.unitTimeSec);
    expect(meta.name).toBe("第 1 回");
    expect(meta.status).toBe("running");
    expect(meta.finishedAt).toBeNull();
  });

  it("tryBumpTurn は expectedTurn が一致する時のみ成功する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    const meta = repo.getMeta(gameId);
    // 新しいゲームは turn=0 (tmp/16-season.md「開始前の状態 = ターン 0」節) で作られる。
    expect(repo.tryBumpTurn(gameId, 1, { ...meta, turn: 2, lastTime: 100 })).toBe(false);
    expect(repo.getMeta(gameId).turn).toBe(0);
    expect(repo.tryBumpTurn(gameId, 0, { ...meta, turn: 1, lastTime: 100 })).toBe(true);
    const updated = repo.getMeta(gameId);
    expect(updated.turn).toBe(1);
    expect(updated.lastTime).toBe(100);
  });

  it("finishGame は status を finished にし、finished_at を記録する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.finishGame(gameId, 999);
    const meta = repo.getMeta(gameId);
    expect(meta.status).toBe("finished");
    expect(meta.finishedAt).toBe(999);
  });

  it("insertIsland → findIsland は terrain/commands/prize/lbbs を含めて完全往復し、返り値の変更は DB に影響しない", () => {
    gameId = repo.createGame(newGameInput({ startAt: 0 }), 0);
    const island = makeIsland(1, "島1");
    repo.insertIsland(gameId, island, 0);

    const loaded = repo.findIsland(gameId, 1);
    expect(loaded).toBeDefined();
    if (loaded === undefined) throw new Error("unreachable");
    expect(loaded.name).toBe("島1");
    expect(loaded.terrain.toJSON()).toEqual(island.terrain.toJSON());
    expect(loaded.commands).toEqual(island.commands);
    expect(loaded.prize).toEqual(island.prize);
    expect(loaded.lbbs).toEqual([]);

    // 返り値を書き換えても DB には影響しない。
    loaded.comment = "書き換え";
    loaded.commands[0] = { ...loaded.commands[0]!, arg: 99 };
    const reloaded = repo.findIsland(gameId, 1);
    expect(reloaded?.comment).not.toBe("書き換え");
    expect(reloaded?.commands[0]?.arg).not.toBe(99);
  });

  it("updateIsland は rank 以外の全列と lbbs を更新する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    const island = makeIsland(1, "島1");
    repo.insertIsland(gameId, island, 0);

    const loaded = repo.findIsland(gameId, 1);
    if (loaded === undefined) throw new Error("unreachable");
    loaded.comment = "更新済み";
    loaded.money = 12345;
    loaded.lbbs = [
      { author: "owner", userId: "owner-1", name: "島主", message: "こんにちは", turn: 1 },
    ];
    repo.updateIsland(gameId, loaded);

    const reloaded = repo.findIsland(gameId, 1);
    expect(reloaded?.comment).toBe("更新済み");
    expect(reloaded?.money).toBe(12345);
    expect(reloaded?.lbbs).toEqual([
      { author: "owner", userId: "owner-1", name: "島主", message: "こんにちは", turn: 1 },
    ]);
  });

  it("listIslandSummaries / loadAllIslands は rank 昇順", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    repo.insertIsland(gameId, makeIsland(2, "島2"), 1);

    expect(repo.listIslandSummaries(gameId).map((s) => s.id)).toEqual([1, 2]);
    expect(repo.loadAllIslands(gameId).map((i) => i.id)).toEqual([1, 2]);
  });

  it("findIslandByName で名前から検索できる", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    expect(repo.findIslandByName(gameId, "島1")?.id).toBe(1);
    expect(repo.findIslandByName(gameId, "存在しない島")).toBeUndefined();
  });

  it("replaceAllIslands は渡された順に rank を振り直し、含まれない島を lbbs ごと削除する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    const island1 = makeIsland(1, "島1");
    const island2 = makeIsland(2, "島2");
    repo.insertIsland(gameId, island1, 0);
    repo.insertIsland(gameId, island2, 1);
    repo.replaceLbbs(gameId, 1, [
      { author: "visitor", userId: "visitor-1", name: "旅人", message: "やあ", turn: 1 },
    ]);

    // island2 が 1 位、island1 は死滅として除外。
    island2.money = 999;
    repo.replaceAllIslands(gameId, [island2]);

    expect(repo.listIslandSummaries(gameId).map((s) => s.id)).toEqual([2]);
    expect(repo.findIsland(gameId, 1)).toBeUndefined();
    expect(repo.findIsland(gameId, 2)?.money).toBe(999);

    // island1 の lbbs_posts も削除されていること。
    const lbbsCount = driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lbbs_posts WHERE game_id = ? AND island_id = 1",
      gameId,
    );
    expect(lbbsCount?.n).toBe(0);
  });

  it("replaceAllIslands で順序を入れ替えても rank の UNIQUE 制約に抵触しない", () => {
    gameId = repo.createGame(newGameInput(), 0);
    const island1 = makeIsland(1, "島1");
    const island2 = makeIsland(2, "島2");
    repo.insertIsland(gameId, island1, 0);
    repo.insertIsland(gameId, island2, 1);

    // 逆順に入れ替え。
    repo.replaceAllIslands(gameId, [island2, island1]);
    expect(repo.listIslandSummaries(gameId).map((s) => s.id)).toEqual([2, 1]);
  });

  it("deleteIsland は lbbs_posts も削除する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    repo.replaceLbbs(gameId, 1, [
      { author: "owner", userId: "owner-1", name: "島主", message: "hi", turn: 1 },
    ]);
    repo.deleteIsland(gameId, 1);
    expect(repo.findIsland(gameId, 1)).toBeUndefined();
    const lbbsCount = driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lbbs_posts WHERE game_id = ? AND island_id = 1",
      gameId,
    );
    expect(lbbsCount?.n).toBe(0);
  });

  it("listLogs は sinceTurn / islandId / includeSecretFor で絞り込み、turn DESC, seq ASC で返す", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: false, islandId: 1, targetId: 0, html: "通常1", seq: 0 },
      { turn: 1, secret: true, islandId: 1, targetId: 0, html: "機密1", seq: 1 },
      { turn: 1, secret: false, islandId: 2, targetId: 1, html: "通常2", seq: 2 },
      { turn: 0, secret: false, islandId: 1, targetId: 0, html: "古い", seq: 0 },
      { turn: 2, secret: false, islandId: 1, targetId: 0, html: "新しい", seq: 0 },
    ]);

    const visitor = repo.listLogs(gameId, { sinceTurn: 1, islandId: 1 });
    // island_id = 1 OR target_id = 1、機密は除外、turn DESC, seq ASC。
    expect(visitor.map((l) => l.html)).toEqual(["新しい", "通常1", "通常2"]);

    const owner = repo.listLogs(gameId, { sinceTurn: 1, islandId: 1, includeSecretFor: 1 });
    expect(owner.map((l) => l.html)).toEqual(["新しい", "通常1", "機密1", "通常2"]);

    const top = repo.listLogs(gameId, { sinceTurn: 1 });
    expect(top.map((l) => l.html).sort()).toEqual(["新しい", "通常1", "通常2"].sort());
  });

  it("appendLogs / listLogs は secret の真偽値を保持する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: true, islandId: 1, targetId: 0, html: "s", seq: 0 },
    ]);
    const logs = repo.listLogs(gameId, { sinceTurn: 1, includeSecretFor: 1 });
    expect(logs[0]?.secret).toBe(true);
  });

  it("deleteLogsBefore は指定 turn 未満を削除する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: false, islandId: 0, targetId: 0, html: "a", seq: 0 },
      { turn: 3, secret: false, islandId: 0, targetId: 0, html: "b", seq: 0 },
    ]);
    repo.deleteLogsBefore(gameId, 3);
    expect(repo.listLogs(gameId, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["b"]);
  });

  it("history: appendHistory / listHistory (新しい順) / trimHistory", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.appendHistory(gameId, [
      { turn: 1, html: "a" },
      { turn: 2, html: "b" },
      { turn: 3, html: "c" },
    ]);
    expect(repo.listHistory(gameId, 10).map((h) => h.html)).toEqual(["c", "b", "a"]);
    repo.trimHistory(gameId, 2);
    expect(repo.listHistory(gameId, 10).map((h) => h.html)).toEqual(["c", "b"]);
  });

  it("reset は全ゲーム・全テーブルの行を削除する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    repo.appendLogs(gameId, [
      { turn: 1, secret: false, islandId: 0, targetId: 0, html: "a", seq: 0 },
    ]);
    repo.appendHistory(gameId, [{ turn: 1, html: "a" }]);

    repo.reset();

    expect(repo.isInitialized()).toBe(false);
    expect(repo.listGames()).toEqual([]);
  });

  it("transaction 内で throw すると変更が残らない (ROLLBACK)", () => {
    gameId = repo.createGame(newGameInput(), 0);
    expect(() =>
      repo.transaction(() => {
        repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(repo.listIslandSummaries(gameId)).toEqual([]);
  });

  it("壊れた JSON (terrain) は findIsland 時に throw する", () => {
    gameId = repo.createGame(newGameInput(), 0);
    repo.insertIsland(gameId, makeIsland(1, "島1"), 0);
    driver.run("UPDATE islands SET terrain = ? WHERE game_id = ? AND id = 1", "not-json", gameId);
    expect(() => repo.findIsland(gameId, 1)).toThrow();
  });

  it("FakeGameRepository と同じ意味論であることの確認 (簡易比較)", () => {
    const fake: GameRepository = new FakeGameRepository();
    const fakeGameId = fake.createGame(newGameInput(), 0);
    gameId = repo.createGame(newGameInput(), 0);
    const island = makeIsland(1, "島1");
    fake.insertIsland(fakeGameId, island, 0);
    repo.insertIsland(gameId, island, 0);
    expect(repo.listIslandSummaries(gameId).map((s) => s.id)).toEqual(
      fake.listIslandSummaries(fakeGameId).map((s) => s.id),
    );
  });

  describe("複数ゲーム (tmp/18-games.md)", () => {
    it("getCurrentGameId は MAX(id) を返し、listGames は新しい順に返す", () => {
      const game1 = repo.createGame(newGameInput({ name: "第 1 回" }), 0);
      expect(repo.getCurrentGameId()).toBe(game1);
      repo.finishGame(game1, 100);
      const game2 = repo.createGame(newGameInput({ name: "第 2 回" }), 200);
      expect(repo.getCurrentGameId()).toBe(game2);
      expect(game2).toBeGreaterThan(game1);

      const games = repo.listGames();
      expect(games.map((g) => g.id)).toEqual([game2, game1]);
      expect(games[0]?.name).toBe("第 2 回");
      expect(games[0]?.status).toBe("running");
      expect(games[1]?.name).toBe("第 1 回");
      expect(games[1]?.status).toBe("finished");
    });

    it("島 ID はゲームごとに独立して採番でき、2 ゲーム分のデータが混ざらない", () => {
      const game1 = repo.createGame(newGameInput({ name: "第 1 回" }), 0);
      repo.finishGame(game1, 100);
      const game2 = repo.createGame(newGameInput({ name: "第 2 回" }), 200);

      const island1a = makeIsland(1, "旧島");
      repo.insertIsland(game1, island1a, 0);
      const island2a = makeIsland(1, "新島"); // 同じ id=1 だが別ゲーム。
      repo.insertIsland(game2, island2a, 0);

      expect(repo.findIsland(game1, 1)?.name).toBe("旧島");
      expect(repo.findIsland(game2, 1)?.name).toBe("新島");
      expect(repo.listIslandSummaries(game1).map((s) => s.name)).toEqual(["旧島"]);
      expect(repo.listIslandSummaries(game2).map((s) => s.name)).toEqual(["新島"]);

      // ログ・履歴・掲示板も混ざらない。
      repo.appendLogs(game1, [
        { turn: 1, secret: false, islandId: 1, targetId: 0, html: "旧ログ", seq: 0 },
      ]);
      repo.appendLogs(game2, [
        { turn: 1, secret: false, islandId: 1, targetId: 0, html: "新ログ", seq: 0 },
      ]);
      expect(repo.listLogs(game1, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["旧ログ"]);
      expect(repo.listLogs(game2, { sinceTurn: 0 }).map((l) => l.html)).toEqual(["新ログ"]);

      repo.appendHistory(game1, [{ turn: 1, html: "旧履歴" }]);
      repo.appendHistory(game2, [{ turn: 1, html: "新履歴" }]);
      expect(repo.listHistory(game1, 10).map((h) => h.html)).toEqual(["旧履歴"]);
      expect(repo.listHistory(game2, 10).map((h) => h.html)).toEqual(["新履歴"]);

      repo.replaceLbbs(game1, 1, [
        { author: "visitor", userId: "v1", name: "旅人", message: "旧board", turn: 1 },
      ]);
      repo.replaceLbbs(game2, 1, [
        { author: "visitor", userId: "v2", name: "旅人", message: "新board", turn: 1 },
      ]);
      expect(repo.findIsland(game1, 1)?.lbbs.map((p) => p.message)).toEqual(["旧board"]);
      expect(repo.findIsland(game2, 1)?.lbbs.map((p) => p.message)).toEqual(["新board"]);

      // listGames の islandCount も正しく反映される。
      const games = repo.listGames();
      const byId = new Map(games.map((g) => [g.id, g]));
      expect(byId.get(game1)?.islandCount).toBe(1);
      expect(byId.get(game2)?.islandCount).toBe(1);
    });
  });

  // tmp/19-abandon.md「データ (スキーマ v6)」節。
  describe("島の放棄", () => {
    it("放棄後は所有の一意性 (部分インデックス) から外れ、同じ owner_user_id で再度 insert できる", () => {
      gameId = repo.createGame(newGameInput(), 0);
      const island1 = makeIsland(1, "島1");
      repo.insertIsland(gameId, island1, 0);

      // 部分インデックス islands_owner_active は abandoned_at IS NULL のときだけ効くため、
      // abandoned_at を設定した行は一意性の対象から外れる。
      const loaded = repo.findIsland(gameId, 1);
      if (loaded === undefined) throw new Error("unreachable");
      loaded.abandonedAt = 999;
      repo.updateIsland(gameId, loaded);

      const island2 = makeNewIsland(defaultConfig, createSeededRng(2), {
        id: 2,
        name: "島2",
        ownerUserId: island1.ownerUserId,
      });
      estimate(island2);
      expect(() => repo.insertIsland(gameId, island2, 1)).not.toThrow();
      expect(repo.findIslandByOwner(gameId, island1.ownerUserId)?.id).toBe(2);
    });

    it("countAbandonments / recordAbandonment は (game_id, user_id) ごとに記録・集計する", () => {
      gameId = repo.createGame(newGameInput(), 0);
      expect(repo.countAbandonments(gameId, "u1")).toBe(0);

      repo.recordAbandonment(gameId, "u1", 1, "島1", 111);
      repo.recordAbandonment(gameId, "u1", 2, "島2", 222);
      repo.recordAbandonment(gameId, "u2", 3, "島3", 333);

      expect(repo.countAbandonments(gameId, "u1")).toBe(2);
      expect(repo.countAbandonments(gameId, "u2")).toBe(1);
    });

    it("findIslandByOwner は abandoned_at が NULL の島だけを返す", () => {
      gameId = repo.createGame(newGameInput(), 0);
      const island = makeIsland(1, "島1");
      repo.insertIsland(gameId, island, 0);
      expect(repo.findIslandByOwner(gameId, island.ownerUserId)?.id).toBe(1);

      const loaded = repo.findIsland(gameId, 1);
      if (loaded === undefined) throw new Error("unreachable");
      loaded.abandonedAt = 999;
      repo.updateIsland(gameId, loaded);
      expect(repo.findIslandByOwner(gameId, island.ownerUserId)).toBeUndefined();
    });
  });
});
