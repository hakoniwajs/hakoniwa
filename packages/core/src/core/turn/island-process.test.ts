import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../config.ts";
import type { DisasterConfig, GameConfig } from "../config.ts";
import { LandKind, PrizeFlag, prizeNames } from "../constants.ts";
import type { Rng } from "../rng.ts";
import { makeTestContext, makeTestIsland, makeTestWorld } from "../test-helpers.ts";
import { getState } from "./context.ts";
import { doIslandProcess } from "./island-process.ts";

/** 決まった値だけを順番に返す Rng スタブ (配列を使い切ったら 0 を返す)。 */
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

/**
 * すべての災害を無効化した設定。個別のテストで対象の災害だけ確率を上書きして確定発生させる。
 * 0 のしきい値は `random(n) < 0` が常に偽になることを利用している。
 */
function disabledDisasterConfig(overrides: Partial<DisasterConfig> = {}): GameConfig {
  const disaster: DisasterConfig = {
    earthquake: 0,
    tsunami: 0,
    typhoon: 0,
    meteo: 0,
    hugeMeteo: 0,
    eruption: 0,
    fire: 0,
    maizo: 0,
    fallBorder: 999999,
    falldown: 0,
    monsBorder1: 999999,
    monsBorder2: 999999,
    monsBorder3: 999999,
    monster: 0,
    ...overrides,
  };
  return { ...defaultConfig, disaster };
}

describe("doIslandProcess: 地震", () => {
  it("地ならし回数を加味した確率で発生し、対象の地形が壊滅する", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    island.terrain.setKind(0, 0, LandKind.Town, 100); // lv>=100
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ earthquake: 1000 }); // 確率1固定
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Waste, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("により壊滅しました"))).toBe(true);
  });
});

describe("doIslandProcess: 飢饉", () => {
  it("食料が0以下だと不足メッセージが出て食料が0になり、対象施設が壊滅しうる", () => {
    const island = makeTestIsland({ id: 1, food: -5 });
    island.terrain.setKind(0, 0, LandKind.Farm, 10);
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig();
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.food).toBe(0);
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Waste, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("食料が不足"))).toBe(true);
  });
});

describe("doIslandProcess: 津波", () => {
  it("周囲の海が多いと崩壊しやすい", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    island.terrain.setKind(5, 5, LandKind.Town, 50); // 周囲は全て海 (デフォルト)
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ tsunami: 1000 });
    const ctx = makeTestContext({ points: [{ x: 5, y: 5 }], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Waste, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("により崩壊しました"))).toBe(true);
  });
});

describe("doIslandProcess: 台風", () => {
  it("周囲に森がないと農場が崩壊しやすい", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    island.terrain.setKind(5, 5, LandKind.Farm, 10);
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ typhoon: 1000 });
    const ctx = makeTestContext({ points: [{ x: 5, y: 5 }], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Plains, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("で飛ばされました"))).toBe(true);
  });
});

describe("doIslandProcess: 怪獣出現", () => {
  it("面積・人口の条件を満たすと最初の町に怪獣が出現する", () => {
    const island = makeTestIsland({ id: 1, food: 100, area: 1 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ monster: 1, monsBorder1: 0 });
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(0, 0).kind).toBe(LandKind.Monster);
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("出現！！"))).toBe(true);
  });

  it("人造怪獣派遣 (monsterSend) はレベル判定に優先する", () => {
    const island = makeTestIsland({ id: 1, food: 100, area: 1 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig(); // monster: 0 のまま (自然発生はしない)
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([]) }, config);
    getState(ctx, island.id).monsterSend = 1;

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Monster, value: 2 }); // kind=0, baseHp=2, hpRange=0
    expect(getState(ctx, island.id).monsterSend).toBe(0);
  });
});

describe("doIslandProcess: 地盤沈下", () => {
  it("面積が閾値を超えていると発生し、陸地は浅瀬に、浅瀬は深い海になる", () => {
    const island = makeTestIsland({ id: 1, food: 100, area: 100 });
    island.terrain.setKind(5, 5, LandKind.Waste, 0); // 周囲は海 (沈む対象)
    island.terrain.setKind(0, 0, LandKind.Sea, 1); // 既存の浅瀬 (深い海になる)
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ fallBorder: 10, falldown: 1000 });
    const ctx = makeTestContext(
      {
        points: [
          { x: 5, y: 5 },
          { x: 0, y: 0 },
        ],
        rng: stubRng([]),
      },
      config,
    );

    doIslandProcess(ctx, world, island);

    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Sea, value: 1 });
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Sea, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("海の中へ沈みました"))).toBe(true);
  });
});

describe("doIslandProcess: 巨大隕石・巨大ミサイル", () => {
  it("巨大隕石は wideDamage を伴い発生する", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ hugeMeteo: 1000 });
    const ctx = makeTestContext({ points: [], rng: stubRng([0, 0]) }, config); // x=0,y=0

    doIslandProcess(ctx, world, island);

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("が落下！！"))).toBe(true);
  });

  it("巨大ミサイルは bigMissile の回数分 wideDamage を発生させる", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig();
    const ctx = makeTestContext({ points: [], rng: stubRng([0, 0, 5, 5]) }, config);
    getState(ctx, island.id).bigMissile = 2;

    doIslandProcess(ctx, world, island);

    const { logs } = ctx.log.flush();
    expect(logs.filter((l) => l.html.includes("地点に落下しました")).length).toBe(2);
    expect(getState(ctx, island.id).bigMissile).toBe(0);
  });
});

describe("doIslandProcess: 隕石", () => {
  it("random(2)!=0 になるまで繰り返し落下する", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ meteo: 1000 });
    // 順序: 地震/津波/怪獣/台風/巨大隕石 (すべてoff,0) → meteo_trigger(0) → 1周目条件(0,無視されるが消費) →
    // x(0) → y(0) → 2周目条件 (1 で終了)。
    const ctx = makeTestContext(
      { points: [], rng: stubRng([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) },
      config,
    );

    doIslandProcess(ctx, world, island);

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("が落下しました"))).toBe(true);
  });
});

describe("doIslandProcess: 噴火", () => {
  it("落下地点が山になり、周囲の地形が変化する (B4: 範囲外を先に判定)", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    // 隅 (0,0) を噴火地点にして範囲外の隣接ヘックスが生じるようにする。
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig({ eruption: 1000 });
    const ctx = makeTestContext({ points: [], rng: stubRng([0, 0]) }, config); // x=0,y=0

    expect(() => doIslandProcess(ctx, world, island)).not.toThrow();

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Mountain, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("が出来ました"))).toBe(true);
  });
});

describe("doIslandProcess: 換金・切り捨て", () => {
  it("食料が9999超なら換金され、資金が9999超なら切り捨てられる", () => {
    const island = makeTestIsland({ id: 1, food: 10009, money: 10000 });
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig();
    const ctx = makeTestContext({ points: [], rng: stubRng([]) }, config);

    doIslandProcess(ctx, world, island);

    expect(island.food).toBe(9999);
    expect(island.money).toBe(9999); // 10000 + int((10009-9999)/10)=1 -> 10001 -> 切り捨てで9999
  });
});

describe("doIslandProcess: 繁栄賞・災難賞", () => {
  it("人口が3000を超えると繁栄賞を受賞する", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    island.terrain.setKind(0, 0, LandKind.Town, 3000);
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig();
    const ctx = makeTestContext({ points: [], rng: stubRng([]) }, config);
    getState(ctx, island.id).oldPop = 0;

    doIslandProcess(ctx, world, island);

    expect(island.prize.flags & PrizeFlag.Prosperity1).not.toBe(0);
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes(prizeNames[1] ?? ""))).toBe(true);
  });

  it("人口が500以上減ると災難賞を受賞する", () => {
    const island = makeTestIsland({ id: 1, food: 100 });
    const world = makeTestWorld([island]);
    const config = disabledDisasterConfig();
    const ctx = makeTestContext({ points: [], rng: stubRng([]) }, config);
    getState(ctx, island.id).oldPop = 600; // pop は 0 (町なし) -> damage=600

    doIslandProcess(ctx, world, island);

    expect(island.prize.flags & PrizeFlag.Disaster1).not.toBe(0);
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes(prizeNames[7] ?? ""))).toBe(true);
  });
});
