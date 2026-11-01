import { describe, expect, it } from "vite-plus/test";
import { LandKind } from "../constants.ts";
import type { Rng } from "../rng.ts";
import { makeTestContext, makeTestIsland } from "../test-helpers.ts";
import { countGrow, doEachHex } from "./each-hex.ts";

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

describe("doEachHex: 町の成長・飢饉", () => {
  it("食料が足りていれば町は成長する", () => {
    const island = makeTestIsland({ id: 1, food: 0 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([4, 999]) });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Town, value: 55 });
  });

  it("食料不足だと町の人口が減り、0以下になると平地に戻る (火災判定はスキップされる)", () => {
    const island = makeTestIsland({ id: 1, food: -1 });
    island.terrain.setKind(0, 0, LandKind.Town, 5);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([10]) });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Plains, value: 0 });
  });

  it("誘致活動中は addpop=30 で成長が早い", () => {
    const island = makeTestIsland({ id: 1, food: 0 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([29, 999]) });
    ctx.state.set(1, {
      oldPop: 0,
      dead: false,
      prepare2: 0,
      bigMissile: 0,
      monsterSend: 0,
      propaganda: true,
    });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Town, value: 80 }); // 50+29+1
  });
});

describe("doEachHex: 平地→町", () => {
  it("countGrow が真で random(5)===0 なら町になる", () => {
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(0, 0, LandKind.Plains, 0);
    island.terrain.setKind(1, 0, LandKind.Town, 50); // 周囲 (neighbor 1) に町
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([0]) });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Town, value: 1 });
  });

  it("countGrow: 周囲の町/農場の value が1 (着弾直後) のときは成長条件を満たさない", () => {
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(1, 0, LandKind.Town, 1);
    expect(countGrow(island.terrain, { x: 0, y: 0 })).toBe(false);
  });
});

describe("doEachHex: 森", () => {
  it("value < 200 なら1増える。200 に達していれば増えない (上限)", () => {
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(0, 0, LandKind.Forest, 199);
    island.terrain.setKind(1, 0, LandKind.Forest, 200);
    const ctx = makeTestContext({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Forest, value: 200 });
    expect(island.terrain.get(1, 0)).toEqual({ kind: LandKind.Forest, value: 200 });
  });
});

describe("doEachHex: 海底油田", () => {
  it("収入が入り、確率で枯渇する", () => {
    const island = makeTestIsland({ id: 1, money: 0 });
    island.terrain.setKind(0, 0, LandKind.Oil, 0);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([5]) }); // 5 < oil.ratio(40)

    doEachHex(ctx, island);

    expect(island.money).toBe(1000); // oil.money
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Sea, value: 0 });
  });

  it("枯渇しなければ収入だけ入り地形は変わらない", () => {
    const island = makeTestIsland({ id: 1, money: 0 });
    island.terrain.setKind(0, 0, LandKind.Oil, 0);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([500]) });

    doEachHex(ctx, island);

    expect(island.money).toBe(1000);
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Oil, value: 0 });
  });
});

describe("doEachHex: 防衛施設自爆", () => {
  it("value===1 で自爆し wideDamage が発動する", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    island.terrain.setKind(0, 0, LandKind.Defence, 1);
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }] });

    doEachHex(ctx, island);

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("自爆装置作動"))).toBe(true);
    // wideDamage により中心 (自身) は海になる
    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Sea, value: 0 });
  });
});

describe("doEachHex: 怪獣移動", () => {
  it("硬化中の怪獣は動かない", () => {
    // kind=2 (サンジラ, special=3: 奇数ターンで硬化)。lv = 2*10+1 = 21
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(5, 5, LandKind.Monster, 21);
    const ctx = makeTestContext({ points: [{ x: 5, y: 5 }], turn: 1 }); // 奇数ターン

    doEachHex(ctx, island);

    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Monster, value: 21 });
  });

  it("移動先が更地なら移動し、元の位置は荒地になる", () => {
    // kind=0 (メカいのら, special=0)。lv=2
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(5, 5, LandKind.Monster, 2);
    island.terrain.setKind(5, 4, LandKind.Waste, 0); // neighbor((5,5),1)
    const ctx = makeTestContext({ points: [{ x: 5, y: 5 }], rng: stubRng([0]) }); // d=1

    doEachHex(ctx, island);

    expect(island.terrain.get(5, 4)).toEqual({ kind: LandKind.Monster, value: 2 });
    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Waste, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("踏み荒らされました"))).toBe(true);
  });

  it("B15: 同じターン内で既に動いた怪獣は再度動かない", () => {
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(5, 5, LandKind.Monster, 2);
    island.terrain.setKind(5, 4, LandKind.Waste, 0);
    // 移動元→移動先の順で処理されるように points を明示する。
    const ctx = makeTestContext({
      points: [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
      ],
      rng: stubRng([0]),
    });

    doEachHex(ctx, island);

    // 移動先で再度動こうとしないので、そのまま留まる。
    expect(island.terrain.get(5, 4)).toEqual({ kind: LandKind.Monster, value: 2 });
  });

  it("防衛施設を踏むと自爆する (dBaseAuto)", () => {
    const island = makeTestIsland({ id: 1 });
    island.terrain.setKind(5, 5, LandKind.Monster, 2);
    island.terrain.setKind(5, 4, LandKind.Defence, 0);
    const ctx = makeTestContext({ points: [{ x: 5, y: 5 }], rng: stubRng([0]) });

    doEachHex(ctx, island);

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("自爆装置が作動"))).toBe(true);
  });
});

describe("doEachHex: 火災", () => {
  it("町 (lv>30) が火災条件を満たすと荒地になる。ログの地形名は現在の (成長後の) 値を使う", () => {
    const island = makeTestIsland({ id: 1, food: 0 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    // 1つめ: 町の成長 random(10) -> 0発目 (lv 50->51)。2つめ: 火災判定 random(1000) -> 3 (< fire=10)
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([0, 3]) });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0)).toEqual({ kind: LandKind.Waste, value: 0 });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("火災"))).toBe(true);
  });

  it("周囲に森か記念碑があれば火災は起きない", () => {
    const island = makeTestIsland({ id: 1, food: 0 });
    island.terrain.setKind(0, 0, LandKind.Town, 50);
    island.terrain.setKind(1, 0, LandKind.Forest, 10); // neighbor 1
    const ctx = makeTestContext({ points: [{ x: 0, y: 0 }], rng: stubRng([0, 3]) });

    doEachHex(ctx, island);

    expect(island.terrain.get(0, 0).kind).toBe(LandKind.Town);
  });
});
