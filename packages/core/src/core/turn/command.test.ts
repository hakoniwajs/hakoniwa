import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../config.ts";
import { CommandKind, commandSpecs, LandKind } from "../constants.ts";
import type { Rng } from "../rng.ts";
import { makeTestContext, makeTestIsland, makeTestWorld } from "../test-helpers.ts";
import type { Command } from "../types.ts";
import { doNothingCommand } from "../types.ts";
import { doCommand } from "./command.ts";
import { findIsland, getState } from "./context.ts";

/** 決まった値だけを返す Rng スタブ。 */
function stubRng(intValues: number[]): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: () => {
      const v = intValues[i] ?? 0;
      i++;
      return v;
    },
  };
}

/** commands[0] だけを指定コマンドにし、残りは資金繰りにした島を作る。 */
function islandWithCommand(command: Command, overrides: Parameters<typeof makeTestIsland>[0] = {}) {
  const island = makeTestIsland(overrides);
  island.commands[0] = command;
  return island;
}

function cmd(partial: Partial<Command>): Command {
  return { kind: CommandKind.DoNothing, target: 0, x: 0, y: 0, arg: 0, ...partial };
}

describe("doCommand: 資金繰り", () => {
  it("money += 10, absent++ し 'consumed' を返す", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.DoNothing }), {
      money: 100,
      absent: 0,
    });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext({ rng: stubRng([999]) });

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("consumed");
    expect(island.money).toBe(110);
    expect(island.absent).toBe(1);
  });

  it("absent が giveupTurns に達したら自動放棄コマンドに差し替える", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.DoNothing }), {
      money: 0,
      absent: defaultConfig.giveupTurns - 1,
    });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);

    expect(island.absent).toBe(defaultConfig.giveupTurns);
    expect(island.commands[0]).toEqual({ ...doNothingCommand, kind: CommandKind.Giveup });
  });

  it("末尾は常に資金繰りになる (不変条件)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.DoNothing }));
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();
    doCommand(ctx, world, island);
    expect(island.commands[island.commands.length - 1]).toEqual(doNothingCommand);
  });
});

describe("doCommand: 資金繰り以外は absent = 0 (B11)", () => {
  it("失敗するコマンドでも absent は 0 にリセットされる", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 0, y: 0 }), {
      absent: 10,
      money: 0,
    });
    island.terrain.setKind(0, 0, LandKind.Sea, 0); // 整地失敗する地形
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    expect(island.absent).toBe(0);
  });
});

describe("doCommand: 資金/食料不足", () => {
  it("資金不足なら 'continue' + logNoMoney", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 0, y: 0 }), { money: 0 });
    island.terrain.setKind(0, 0, LandKind.Waste, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs[0]!.html).toContain("資金不足");
    // 地形は変化しない
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Waste, value: 0 });
  });

  it("食料不足なら 'continue' + logNoFood", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Sell, arg: 1 }), { food: 50 });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs[0]!.html).toContain("備蓄食料不足");
  });

  it("末尾は常に資金繰りになる (資金不足でも不変条件)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 0, y: 0 }), { money: 0 });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();
    doCommand(ctx, world, island);
    expect(island.commands[island.commands.length - 1]).toEqual(doNothingCommand);
  });
});

describe("doCommand: 整地/地ならし", () => {
  it("整地成功: 荒地→平地、金を消費、'consumed'", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 2, y: 2 }), {
      money: 100,
    });
    island.terrain.setKind(2, 2, LandKind.Waste, 0);
    const world = makeTestWorld([island]);
    // maizo 判定 (int(1000)) は閾値以上にして発生させない
    const ctx = makeTestContext({ rng: stubRng([999]) });

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("consumed");
    expect(island.terrain.get(2, 2)).toEqual({ kind: LandKind.Plains, value: 0 });
    expect(island.money).toBe(100 - commandSpecs[CommandKind.Prepare].cost);
  });

  it("整地失敗: 海/海底基地/油田/山/怪獣には整地できず 'continue'", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 2, y: 2 }), {
      money: 100,
    });
    island.terrain.setKind(2, 2, LandKind.Mountain, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    expect(island.terrain.get(2, 2)).toEqual({ kind: LandKind.Mountain, value: 0 });
  });

  it("地ならし: prepare2 をカウントし 'continue' (B13)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare2, x: 2, y: 2 }), {
      money: 200,
    });
    island.terrain.setKind(2, 2, LandKind.Waste, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    expect(island.terrain.get(2, 2)).toEqual({ kind: LandKind.Plains, value: 0 });
    expect(getState(ctx, island.id).prepare2).toBe(1);
  });

  it("整地成功時、確率で埋蔵金が見つかる", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Prepare, x: 2, y: 2 }), {
      money: 100,
    });
    island.terrain.setKind(2, 2, LandKind.Waste, 0);
    const world = makeTestWorld([island]);
    // int(1000) < disaster.maizo(10) を満たす値、続く v = 100 + int(901)
    const ctx = makeTestContext({ rng: stubRng([0, 50]) });

    doCommand(ctx, world, island);

    expect(island.money).toBe(100 - commandSpecs[CommandKind.Prepare].cost + 150);
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("埋蔵金"))).toBe(true);
  });
});

describe("doCommand: 埋め立て", () => {
  it("全周囲が海なら失敗 (logNoLandAround)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Reclaim, x: 5, y: 5 }), {
      money: 500,
    });
    // デフォルトで全面海 -> 周囲7は全部海
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs[0]!.html).toContain("周辺に陸地がなかった");
  });

  it("陸に囲まれていれば成功し、浅瀬→荒地になる", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Reclaim, x: 5, y: 5 }), {
      money: 500,
    });
    island.terrain.setKind(5, 5, LandKind.Sea, 1); // 浅瀬
    // 周囲を全部陸にする
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) {
        if (x === 5 && y === 5) continue;
        island.terrain.setKind(x, y, LandKind.Plains, 0);
      }
    }
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("consumed");
    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Waste, value: 0 });
  });
});

describe("doCommand: 掘削 (油田探し)", () => {
  it("深い海 (value=0) では油田探しになり、見つかることがある", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Destroy, x: 5, y: 5, arg: 1 }), {
      money: 1000,
    });
    island.terrain.setKind(5, 5, LandKind.Sea, 0);
    const world = makeTestWorld([island]);
    // probability = int(value/cost) = int(200/200) = 1 > int(100) が成立するように 0 を返す
    const ctx = makeTestContext({ rng: stubRng([0]) });

    doCommand(ctx, world, island);

    expect(island.terrain.get(5, 5).kind).toBe(LandKind.Oil);
  });

  it("見つからないこともある", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Destroy, x: 5, y: 5, arg: 1 }), {
      money: 1000,
    });
    island.terrain.setKind(5, 5, LandKind.Sea, 0);
    const world = makeTestWorld([island]);
    // probability(1) > int(100) を満たさない値 (例:50) を返す
    const ctx = makeTestContext({ rng: stubRng([50]) });

    doCommand(ctx, world, island);

    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Sea, value: 0 });
  });

  it("海底基地/油田/怪獣は掘削できない", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Destroy, x: 5, y: 5 }), {
      money: 1000,
    });
    island.terrain.setKind(5, 5, LandKind.Sbase, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
  });

  it("山を掘削すると荒地になる", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Destroy, x: 5, y: 5 }), {
      money: 1000,
    });
    island.terrain.setKind(5, 5, LandKind.Mountain, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Waste, value: 0 });
  });
});

describe("doCommand: 伐採", () => {
  it("森なら平地になり木の価値で金が増える", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.SellTree, x: 3, y: 3 }), {
      money: 0,
    });
    island.terrain.setKind(3, 3, LandKind.Forest, 4);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("consumed");
    expect(island.terrain.get(3, 3)).toEqual({ kind: LandKind.Plains, value: 0 });
    expect(island.money).toBe(defaultConfig.treeValue * 4);
  });

  it("森以外は伐採できない", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.SellTree, x: 3, y: 3 }));
    island.terrain.setKind(3, 3, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    expect(doCommand(ctx, world, island)).toBe("continue");
  });
});

describe("doCommand: 地上建設系", () => {
  it("植林成功: 平地→森", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Plant, x: 1, y: 1 }), { money: 100 });
    island.terrain.setKind(1, 1, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    expect(doCommand(ctx, world, island)).toBe("consumed");
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Forest, value: 1 });
  });

  it("不適当な地形なら失敗", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Plant, x: 1, y: 1 }), { money: 100 });
    island.terrain.setKind(1, 1, LandKind.Mountain, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    expect(doCommand(ctx, world, island)).toBe("continue");
  });

  it("農場: 既存の農場は規模+2 (最大50)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Farm, x: 1, y: 1 }), { money: 100 });
    island.terrain.setKind(1, 1, LandKind.Farm, 49);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Farm, value: 50 });
  });

  it("農場: 回数付き (arg>1) は arg-1 で先頭に再投入される", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Farm, x: 1, y: 1, arg: 3 }), {
      money: 1000,
    });
    island.terrain.setKind(1, 1, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);

    expect(outcome).toBe("consumed");
    expect(island.commands[0]).toEqual({
      kind: CommandKind.Farm,
      target: 0,
      x: 1,
      y: 1,
      arg: 2,
    });
    // 元のキューは資金繰りだけだったので、末尾も資金繰りのまま保たれる
    expect(island.commands[island.commands.length - 1]).toEqual(doNothingCommand);
  });

  it("防衛施設: 既に防衛施設なら自爆装置をセットする", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Dbase, x: 1, y: 1 }), { money: 1000 });
    island.terrain.setKind(1, 1, LandKind.Defence, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Defence, value: 1 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("自爆装置がセット"))).toBe(true);
  });

  it("記念碑: 新規建造", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Monument, x: 1, y: 1, arg: 1 }), {
      money: 100_000,
    });
    island.terrain.setKind(1, 1, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Monument, value: 1 });
  });

  it("記念碑: 既に記念碑なら「発射」し、target 島の bigMissile が増える (B8 維持)", () => {
    const attacker = islandWithCommand(cmd({ kind: CommandKind.Monument, x: 1, y: 1, target: 2 }), {
      id: 1,
      name: "たろう",
      money: 100_000,
    });
    attacker.terrain.setKind(1, 1, LandKind.Monument, 0);
    const target = makeTestIsland({ id: 2, name: "じろう" });
    const world = makeTestWorld([attacker, target]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, attacker);

    expect(outcome).toBe("consumed");
    expect(attacker.terrain.get(1, 1)).toEqual({ kind: LandKind.Waste, value: 0 });
    expect(getState(ctx, target.id).bigMissile).toBe(1);
  });

  it("記念碑: target 不在なら黙って 'continue' (B8)", () => {
    const attacker = islandWithCommand(
      cmd({ kind: CommandKind.Monument, x: 1, y: 1, target: 999 }),
      { id: 1, name: "たろう", money: 100_000 },
    );
    attacker.terrain.setKind(1, 1, LandKind.Monument, 0);
    const world = makeTestWorld([attacker]);
    const ctx = makeTestContext();
    const moneyBefore = attacker.money;

    const outcome = doCommand(ctx, world, attacker);

    expect(outcome).toBe("continue");
    expect(attacker.terrain.get(1, 1)).toEqual({ kind: LandKind.Monument, value: 0 });
    expect(attacker.money).toBe(moneyBefore); // 金は差し引かれない
    expect(ctx.log.flush().logs).toEqual([]); // ログも出ない
  });

  it("ハリボテ: secret + normal(整地成功扱い) の2ログ", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Haribote, x: 1, y: 1 }), {
      money: 100,
    });
    island.terrain.setKind(1, 1, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Haribote, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs).toHaveLength(2);
    expect(logs.some((l) => l.secret)).toBe(true);
  });
});

describe("doCommand: 採掘場", () => {
  it("山になら作れ、規模+5 (最大200)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Mountain, x: 1, y: 1 }), {
      money: 1000,
    });
    island.terrain.setKind(1, 1, LandKind.Mountain, 199);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Mountain, value: 200 });
  });

  it("山以外には作れない", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Mountain, x: 1, y: 1 }), {
      money: 1000,
    });
    island.terrain.setKind(1, 1, LandKind.Plains, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    expect(doCommand(ctx, world, island)).toBe("continue");
  });

  it("回数付き (arg>1) は arg-1 で先頭に再投入される", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Mountain, x: 1, y: 1, arg: 2 }), {
      money: 1000,
    });
    island.terrain.setKind(1, 1, LandKind.Mountain, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.commands[0]).toEqual({
      kind: CommandKind.Mountain,
      target: 0,
      x: 1,
      y: 1,
      arg: 1,
    });
  });
});

describe("doCommand: 海底基地", () => {
  it("深い海になら作れる", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Sbase, x: 1, y: 1 }), {
      money: 100_000,
    });
    island.terrain.setKind(1, 1, LandKind.Sea, 0);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    doCommand(ctx, world, island);
    expect(island.terrain.get(1, 1)).toEqual({ kind: LandKind.Sbase, value: 0 });
  });

  it("浅瀬や陸には作れない", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Sbase, x: 1, y: 1 }), {
      money: 100_000,
    });
    island.terrain.setKind(1, 1, LandKind.Sea, 1);
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    expect(doCommand(ctx, world, island)).toBe("continue");
  });
});

describe("doCommand: 怪獣派遣", () => {
  it("target 不在なら logMsNoTarget + 'continue'", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.SendMonster, target: 999 }), {
      money: 10_000,
    });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
    expect(ctx.log.flush().logs[0]!.html).toContain("目標の島に人が見当たらない");
  });

  it("target が存在すれば monsterSend が増える", () => {
    const attacker = islandWithCommand(cmd({ kind: CommandKind.SendMonster, target: 2 }), {
      id: 1,
      money: 10_000,
    });
    const target = makeTestIsland({ id: 2, name: "じろう" });
    const world = makeTestWorld([attacker, target]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, attacker);
    expect(outcome).toBe("consumed");
    expect(getState(ctx, target.id).monsterSend).toBe(1);
  });
});

describe("doCommand: 食料輸出/援助 (B13: continue)", () => {
  it("食料輸出は 'continue' で金と食料が動く", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Sell, arg: 1 }), { food: 500 });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
    expect(island.food).toBe(400);
    expect(island.money).toBe(defaultConfig.initialMoney + 10);
  });

  it("資金援助は target 不在なら logMsNoTarget を出し 'continue' (B2 修正)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Money, target: 999, arg: 1 }), {
      money: 1000,
    });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
    expect(ctx.log.flush().logs[0]!.html).toContain("目標の島に人が見当たらない");
    expect(island.money).toBe(1000); // 何も動かない
  });

  it("食料援助は target 不在なら logMsNoTarget を出し 'continue' (B2 修正)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Food, target: 999, arg: 1 }), {
      food: 1000,
    });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
    expect(island.food).toBe(1000);
  });

  // tmp/19-abandon.md「対象外」節: 放棄島への援助も target 不在扱いになる。
  it("資金援助は target が放棄島なら logMsNoTarget を出し 'continue' (19)", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Money, target: 2, arg: 1 }), {
      money: 1000,
    });
    const abandoned = makeTestIsland({ id: 2, name: "じろう", abandonedAt: 12345 });
    const world = makeTestWorld([island, abandoned]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("continue");
    expect(ctx.log.flush().logs[0]!.html).toContain("目標の島に人が見当たらない");
    expect(island.money).toBe(1000);
  });

  it("資金援助は target 存在時に双方の残高が動く", () => {
    const donor = islandWithCommand(cmd({ kind: CommandKind.Money, target: 2, arg: 1 }), {
      id: 1,
      money: 1000,
    });
    const receiver = makeTestIsland({ id: 2, name: "じろう", money: 0 });
    const world = makeTestWorld([donor, receiver]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, donor);
    expect(outcome).toBe("continue");
    const cost = commandSpecs[CommandKind.Money].cost;
    expect(donor.money).toBe(1000 - cost);
    expect(findIsland(world, 2)!.money).toBe(cost);
  });
});

describe("doCommand: 誘致活動", () => {
  it("propaganda フラグが立つ", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Propaganda }), { money: 10_000 });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("consumed");
    expect(getState(ctx, island.id).propaganda).toBe(true);
  });
});

describe("doCommand: 島の放棄", () => {
  it("dead フラグが立ち、放棄ログと発見史が記録される", () => {
    const island = islandWithCommand(cmd({ kind: CommandKind.Giveup }), { id: 1, name: "たろう" });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext();

    const outcome = doCommand(ctx, world, island);
    expect(outcome).toBe("consumed");
    expect(getState(ctx, island.id).dead).toBe(true);
    const { logs, history } = ctx.log.flush();
    expect(logs[0]!.html).toContain("無人島");
    expect(history[0]!.html).toContain("放棄");
  });
});
