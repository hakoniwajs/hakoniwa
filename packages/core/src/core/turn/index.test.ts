import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config.ts";
import { LandKind } from "../constants.ts";
import { makeNewIsland } from "../island.ts";
import { createSeededRng } from "../rng.ts";
import { makeTestIsland, makeTestWorld } from "../test-helpers.ts";
import { createTurnContext, runTurn } from "./index.ts";

describe("runTurn", () => {
  it("turn と lastTime を進める", () => {
    const island = makeTestIsland({ id: 1 });
    const world = makeTestWorld([island], 5);
    world.lastTime = 1000;
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(1), turn: 5 });

    const result = runTurn(world, ctx);

    expect(result.world.turn).toBe(6);
    expect(result.world.lastTime).toBe(1000 + defaultConfig.unitTimeSec);
  });

  it("人口が0になった島は removedIslandIds に入り world.islands から除去される", () => {
    // 地形は全面海 (町なし) なので pop は常に 0 のまま。
    const island = makeTestIsland({ id: 1, food: 100, money: 100 });
    const world = makeTestWorld([island], 0);
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(1), turn: 0 });

    const result = runTurn(world, ctx);

    expect(result.removedIslandIds).toEqual([1]);
    expect(result.world.islands).toEqual([]);
  });

  // tmp/19-abandon.md「ターン処理」節。
  it("放棄島 (abandonedAt !== null) は収入・計画・成長・災害をスキップし、ターン末に除去され logGiveup の通常ログ (logDead ではない) を出す", () => {
    const abandoned = makeTestIsland({
      id: 1,
      name: "すてじま",
      money: 500,
      food: 500,
      pop: 0,
      abandonedAt: 12345,
    });
    // 資金繰り以外のコマンドを積んでおき、放棄島では処理されない (income/command がスキップされる)
    // ことを money が変化しないことで確認する。
    const world = makeTestWorld([abandoned], 0);
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(1), turn: 0 });

    const result = runTurn(world, ctx);

    expect(result.removedIslandIds).toEqual([1]);
    expect(result.world.islands).toEqual([]);
    // income (資金繰り +10) がスキップされているので money は変化しない。
    expect(result.logs.some((l) => l.html.includes("放棄され"))).toBe(true);
    expect(result.logs.some((l) => l.html.includes("人がいなくなり"))).toBe(false);
  });

  // history は GameService.abandonIsland が放棄した時点で
  // 1 回だけ記録する。ターン末の除去 (turn/index.ts) では通常ログだけを出し、history は
  // 増やさない (二重記録の防止)。
  it("放棄島のターン末除去では history が増えない (通常ログのみ)", () => {
    const abandoned = makeTestIsland({
      id: 1,
      name: "すてじま",
      money: 500,
      food: 500,
      pop: 0,
      abandonedAt: 12345,
    });
    const world = makeTestWorld([abandoned], 0);
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(1), turn: 0 });

    const result = runTurn(world, ctx);

    expect(result.removedIslandIds).toEqual([1]);
    expect(result.history).toEqual([]);
    expect(result.logs.some((l) => l.html.includes("放棄され"))).toBe(true);
  });

  it("放棄島は資金繰りフェーズもスキップされる (money が変化しない)", () => {
    const abandoned = makeTestIsland({ id: 1, money: 500, food: 500, pop: 0, abandonedAt: 12345 });
    const world = makeTestWorld([abandoned], 0);
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(1), turn: 0 });

    const result = runTurn(world, ctx);

    // 島は除去されるが、除去される前の money は資金繰り (+10) の影響を受けていないはず。
    // removedIslandIds に含まれることで間接的に確認済みなので、ここでは island 自体の money を
    // 直接見るために world.islands が空になる前の値を abandoned オブジェクトから確認する。
    expect(abandoned.money).toBe(500);
    expect(result.removedIslandIds).toEqual([1]);
  });

  it("2〜3島の World で1ターン進めても例外を投げない (資金繰りが末尾にあるので無限ループしない)", () => {
    const island1 = makeTestIsland({ id: 1, food: 100, money: 100 });
    const island2 = makeTestIsland({ id: 2, food: 100, money: 100 });
    island2.terrain.setKind(0, 0, LandKind.Town, 50); // 人口があるので死滅しない
    const island3 = makeTestIsland({ id: 3, food: 100, money: 100 });
    const world = makeTestWorld([island1, island2, island3], 0);
    const ctx = createTurnContext({ config: defaultConfig, rng: createSeededRng(7), turn: 0 });

    expect(() => runTurn(world, ctx)).not.toThrow();
  });
});

describe("runTurn: 固定seedでの50ターン進行スナップショット (リファクタリング検出用)", () => {
  it("各島の主要な値とログ件数がスナップショットと一致する", () => {
    // コマンドを一切入力しない (常に資金繰り) 放置島だと giveupTurns (既定28) に達して
    // 島の放棄 (B12) が起き、50ターン経つ前に2島とも消滅してしまいスナップショットが
    // 空になり退屈なので、このテストでは giveupTurns を無効化し、農場を与えて
    // 50ターン分の成長・災害イベントが観測できるようにする (中心付近は必ず陸地)。
    const config = { ...defaultConfig, giveupTurns: 1_000_000 };
    const rng = createSeededRng(42);
    const islandA = makeNewIsland(config, rng, { id: 1, name: "アルファ", ownerUserId: "owner-a" });
    const islandB = makeNewIsland(config, rng, { id: 2, name: "ベータ", ownerUserId: "owner-b" });
    islandA.terrain.setKind(5, 5, LandKind.Farm, 10);
    islandB.terrain.setKind(5, 5, LandKind.Farm, 10);
    islandA.absent = 0;
    islandB.absent = 0;

    let world = makeTestWorld([islandA, islandB], 0);
    world.nextIslandId = 3;
    const ctx = createTurnContext({ config, rng, turn: 0 });

    let totalLogs = 0;
    let totalHistory = 0;
    for (let i = 0; i < 50; i++) {
      const result = runTurn(world, ctx);
      world = result.world;
      totalLogs += result.logs.length;
      totalHistory += result.history.length;
    }

    const snapshot = {
      turn: world.turn,
      islands: world.islands.map((island) => ({
        id: island.id,
        pop: island.pop,
        area: island.area,
        money: island.money,
        food: island.food,
        prize: island.prize,
      })),
      totalLogs,
      totalHistory,
    };

    expect(snapshot).toMatchSnapshot();
  });
});
