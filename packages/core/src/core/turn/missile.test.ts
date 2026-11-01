import { describe, expect, it } from "vite-plus/test";
import { CommandKind, LandKind } from "../constants.ts";
import type { Point } from "../geometry.ts";
import type { Rng } from "../rng.ts";
import { makeTestContext, makeTestIsland, makeTestWorld } from "../test-helpers.ts";
import type { Command } from "../types.ts";
import { doMissile } from "./missile.ts";

/** 決まった値だけを順番に返す Rng スタブ。 */
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

/** (0,0) から (size-1,size-1) までを行優先で並べた座標一覧 (基地探索・難民探索の走査順を固定するため)。 */
function allPoints(size: number): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      points.push({ x, y });
    }
  }
  return points;
}

function cmd(partial: Partial<Command>): Command {
  return { kind: CommandKind.MissileNM, target: 0, x: 0, y: 0, arg: 0, ...partial };
}

describe("doMissile: 対象なし/基地なし", () => {
  it("ターゲットが存在しなければ logMsNoTarget を出し 'continue' を返す", () => {
    const island = makeTestIsland({ id: 1, money: 100 });
    const world = makeTestWorld([island]);
    const ctx = makeTestContext({ points: allPoints(12) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 999, x: 5, y: 5 }));

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("目標の島に人が見当たらない"))).toBe(true);
  });

  // tmp/19-abandon.md「対象外」節: 放棄島はターゲット解決 (findIsland) から除外される。
  it("ターゲットが放棄島なら logMsNoTarget を出し 'continue' を返す", () => {
    const island = makeTestIsland({ id: 1, money: 100 });
    const target = makeTestIsland({ id: 2, abandonedAt: 12345 });
    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 2, x: 5, y: 5 }));

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("目標の島に人が見当たらない"))).toBe(true);
  });

  it("基地が一つもなければ logMsNoBase を出し 'continue' を返す", () => {
    const island = makeTestIsland({ id: 1, money: 100 });
    const target = makeTestIsland({ id: 2 });
    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 2, x: 5, y: 5 }));

    expect(outcome).toBe("continue");
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("ミサイル設備を保有していない"))).toBe(true);
  });
});

describe("doMissile: 防衛施設", () => {
  it("防衛施設の周囲に着弾すると空中爆発し、判定結果を標的島IDキーのキャッシュに記録する", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 20); // exp20 -> level2 (2発)

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Town, 10); // 着弾点 (防衛施設ではない)
    target.terrain.setKind(7, 5, LandKind.Defence, 0); // neighbor((6,6),1) に防衛施設

    const world = makeTestWorld([island, target]);
    // 2発とも同じ点 (6,6) へ (r=0 は command の (x,y) そのもの)。
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0, 0]) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 2, x: 6, y: 6 }));

    expect(outcome).toBe("consumed");
    const cache = ctx.defenceCache.get(2);
    expect(cache).toBeDefined();
    expect(cache?.[6 * 12 + 6]).toBe(1);

    const { logs } = ctx.log.flush();
    const caughtLogs = logs.filter((l) => l.html.includes("空中爆発"));
    expect(caughtLogs.length).toBe(2); // キャッシュヒットでも同じログが出る
  });
});

describe("doMissile: 通常弾", () => {
  it("町に命中すると荒地 (value 1) になり、基地に経験値が入る", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 0); // exp0 -> level1 (1発)

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Town, 40);

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0]) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 2, x: 6, y: 6 }));

    expect(outcome).toBe("consumed");
    expect(target.terrain.get(6, 6)).toEqual({ kind: LandKind.Waste, value: 1 });
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Base, value: 2 }); // int(40/20)=2

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("一帯が壊滅しました"))).toBe(true);
  });

  it("怪獣を撃破すると残骸収入が入り、prize.monsters にビットが立つ", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 0);

    const target = makeTestIsland({ id: 2, money: 0 });
    target.terrain.setKind(6, 6, LandKind.Monster, 11); // kind=1 (いのら), hp=1

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0]) });

    doMissile(ctx, world, island, cmd({ target: 2, x: 6, y: 6 }));

    expect(target.terrain.get(6, 6)).toEqual({ kind: LandKind.Waste, value: 1 });
    expect(target.money).toBe(400); // monsters[1].value
    expect(target.prize.monsters).toBe(1 << 1);
    expect(island.terrain.get(0, 0).value).toBe(5); // monsters[1].exp

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("力尽き、倒れました"))).toBe(true);
  });

  it("難民が発生し、発射元の平地が町になる (通常弾のみ・自島攻撃では発生しない)", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 0);
    island.terrain.setKind(1, 0, LandKind.Plains, 0);

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Town, 100);

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0]) });

    doMissile(ctx, world, island, cmd({ target: 2, x: 6, y: 6 }));

    // boat = int(100/2) = 50 -> 平地に boat>10 なので value=5 の町になる
    expect(island.terrain.get(1, 0)).toEqual({ kind: LandKind.Town, value: 5 });

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("難民"))).toBe(true);
  });

  it("STミサイルでは町に命中しても難民は発生しない", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 0);
    island.terrain.setKind(1, 0, LandKind.Plains, 0);

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Town, 100);

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0]) });

    doMissile(ctx, world, island, cmd({ kind: CommandKind.MissileST, target: 2, x: 6, y: 6 }));

    expect(island.terrain.get(1, 0)).toEqual({ kind: LandKind.Plains, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("難民"))).toBe(false);
  });
});

describe("doMissile: 陸地破壊弾", () => {
  it("山に命中すると荒地に、それ以外の陸地に命中すると浅瀬になる", () => {
    const island = makeTestIsland({ id: 1, money: 1000 });
    island.terrain.setKind(0, 0, LandKind.Base, 20); // level2 (2発)

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Mountain, 0);
    target.terrain.setKind(7, 5, LandKind.Plains, 0); // neighbor((6,6),1)

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0, 1]) });

    doMissile(ctx, world, island, cmd({ kind: CommandKind.MissileLD, target: 2, x: 6, y: 6 }));

    expect(target.terrain.get(6, 6)).toEqual({ kind: LandKind.Waste, value: 0 });
    expect(target.terrain.get(7, 5)).toEqual({ kind: LandKind.Sea, value: 1 });
  });
});

describe("doMissile: B9 資金の厳密比較", () => {
  it("money === cost のとき、基地は見つかるが1発も発射されない", () => {
    const island = makeTestIsland({ id: 1, money: 20 }); // NM の cost と同額
    island.terrain.setKind(0, 0, LandKind.Base, 0);

    const target = makeTestIsland({ id: 2 });
    target.terrain.setKind(6, 6, LandKind.Town, 40);

    const world = makeTestWorld([island, target]);
    const ctx = makeTestContext({ points: allPoints(12), rng: stubRng([0]) });

    const outcome = doMissile(ctx, world, island, cmd({ target: 2, x: 6, y: 6 }));

    expect(outcome).toBe("consumed"); // 基地は見つかったので 'continue' にはならない
    expect(island.money).toBe(20); // 1発も撃てないので消費されない
    expect(target.terrain.get(6, 6)).toEqual({ kind: LandKind.Town, value: 40 }); // 変化なし
  });
});
