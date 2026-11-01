import { describe, expect, it } from "vite-plus/test";
import { LandKind } from "../constants.ts";
import { neighbor } from "../geometry.ts";
import { makeTestContext, makeTestIsland } from "../test-helpers.ts";
import { wideDamage } from "./wide-damage.ts";

describe("wideDamage", () => {
  it("中心が海: 値を0にリセットするだけでログは出ない", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    // デフォルトで全面海。中心を浅瀬にしておく。
    island.terrain.setKind(5, 5, LandKind.Sea, 1);
    const ctx = makeTestContext();
    wideDamage(ctx, island, 5, 5);
    expect(island.terrain.get(5, 5)).toEqual({ kind: LandKind.Sea, value: 0 });
    expect(ctx.log.flush().logs).toEqual([]);
  });

  it("1ヘックス圏 (中心以外) は浅瀬になり、2ヘックス圏は荒地になる。範囲外は無視する", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    const center = { x: 5, y: 5 };

    const oneHex = neighbor(center, 1); // 1ヘックス圏
    island.terrain.setKind(oneHex.x, oneHex.y, LandKind.Waste, 0);

    const twoHex = neighbor(center, 7); // 2ヘックス圏 (荒地は本来スキップだが Town で確認)
    island.terrain.setKind(twoHex.x, twoHex.y, LandKind.Town, 20);

    island.terrain.setKind(center.x, center.y, LandKind.Town, 50);

    const ctx = makeTestContext();
    wideDamage(ctx, island, center.x, center.y);

    // 中心 (i===0): 海、value=0
    expect(island.terrain.get(center.x, center.y)).toEqual({ kind: LandKind.Sea, value: 0 });
    // 1ヘックス圏: 浅瀬 (value=1)
    expect(island.terrain.get(oneHex.x, oneHex.y)).toEqual({ kind: LandKind.Sea, value: 1 });
    // 2ヘックス圏: 荒地
    expect(island.terrain.get(twoHex.x, twoHex.y)).toEqual({ kind: LandKind.Waste, value: 0 });

    const { logs } = ctx.log.flush();
    expect(logs.every((l) => l.secret === false)).toBe(true);
    expect(logs.some((l) => l.html.includes("水没"))).toBe(true);
    expect(logs.some((l) => l.html.includes("荒地"))).toBe(true);
  });

  it("2ヘックス圏の荒地/海/油田/山/海底基地は無視される (ログもテレインも変化なし)", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    const center = { x: 5, y: 5 };
    const twoHexWaste = neighbor(center, 7);
    island.terrain.setKind(twoHexWaste.x, twoHexWaste.y, LandKind.Waste, 0);
    const twoHexMountain = neighbor(center, 8);
    island.terrain.setKind(twoHexMountain.x, twoHexMountain.y, LandKind.Mountain, 10);

    const ctx = makeTestContext();
    wideDamage(ctx, island, center.x, center.y);

    expect(island.terrain.get(twoHexWaste.x, twoHexWaste.y)).toEqual({
      kind: LandKind.Waste,
      value: 0,
    });
    expect(island.terrain.get(twoHexMountain.x, twoHexMountain.y)).toEqual({
      kind: LandKind.Mountain,
      value: 10,
    });
  });

  it("海底基地/油田は 1ヘックス圏で跡形もなく消える (logWideDamageSea2)", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    const center = { x: 5, y: 5 };
    const oneHexSbase = neighbor(center, 2);
    island.terrain.setKind(oneHexSbase.x, oneHexSbase.y, LandKind.Sbase, 0);

    const ctx = makeTestContext();
    wideDamage(ctx, island, center.x, center.y);

    expect(island.terrain.get(oneHexSbase.x, oneHexSbase.y)).toEqual({
      kind: LandKind.Sea,
      value: 0,
    });
    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("跡形もなくなりました"))).toBe(true);
  });

  it("怪獣は1ヘックス圏で水没、2ヘックス圏で消し飛ぶ専用ログになる", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    const center = { x: 5, y: 5 };
    const oneHexMonster = neighbor(center, 3);
    island.terrain.setKind(oneHexMonster.x, oneHexMonster.y, LandKind.Monster, 15);
    const twoHexMonster = neighbor(center, 9);
    island.terrain.setKind(twoHexMonster.x, twoHexMonster.y, LandKind.Monster, 15);

    const ctx = makeTestContext();
    wideDamage(ctx, island, center.x, center.y);

    expect(island.terrain.get(oneHexMonster.x, oneHexMonster.y)).toEqual({
      kind: LandKind.Sea,
      value: 1,
    });
    expect(island.terrain.get(twoHexMonster.x, twoHexMonster.y)).toEqual({
      kind: LandKind.Waste,
      value: 0,
    });

    const { logs } = ctx.log.flush();
    expect(logs.some((l) => l.html.includes("怪獣") && l.html.includes("もろとも水没"))).toBe(true);
    expect(logs.some((l) => l.html.includes("怪獣") && l.html.includes("消し飛びました"))).toBe(
      true,
    );
  });

  it("B4: 範囲外を先に判定するので、盤面の隅を中心にしても例外を投げない", () => {
    const island = makeTestIsland({ id: 1, name: "たろう" });
    const ctx = makeTestContext();
    expect(() => wideDamage(ctx, island, 0, 0)).not.toThrow();
    expect(() => wideDamage(ctx, island, 11, 11)).not.toThrow();
  });
});
