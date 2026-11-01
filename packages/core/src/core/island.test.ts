import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "./config.ts";
import { LandKind } from "./constants.ts";
import { estimate, makeNewIsland, makeNewLand } from "./island.ts";
import { createSeededRng } from "./rng.ts";
import { createTerrain } from "./terrain.ts";
import { doNothingCommand } from "./types.ts";

describe("makeNewLand", () => {
  it("森4/町2/山1/基地1がちょうど存在する", () => {
    const terrain = makeNewLand(12, createSeededRng(42));
    const counts = new Map<number, number>();
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const kind = terrain.get(x, y).kind;
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    expect(counts.get(LandKind.Forest)).toBe(4);
    expect(counts.get(LandKind.Town)).toBe(2);
    expect(counts.get(LandKind.Mountain)).toBe(1);
    expect(counts.get(LandKind.Base)).toBe(1);
  });

  it("陸地 (海以外) の数が妥当な範囲に収まる", () => {
    const terrain = makeNewLand(12, createSeededRng(42));
    let land = 0;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        if (terrain.get(x, y).kind !== LandKind.Sea) {
          land++;
        }
      }
    }
    // 中央4x4(16) + 森/町/山/基地 8 が最低保証され、8x8=64 が上限。
    expect(land).toBeGreaterThanOrEqual(16);
    expect(land).toBeLessThanOrEqual(64);
  });

  it("8x8範囲外 (外周) は必ず海", () => {
    const terrain = makeNewLand(12, createSeededRng(7));
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        if (x < 2 || x > 9 || y < 2 || y > 9) {
          expect(terrain.get(x, y)).toEqual({ kind: LandKind.Sea, value: 0 });
        }
      }
    }
  });

  it("同じ seed なら同じ地形になる", () => {
    const a = makeNewLand(12, createSeededRng(123));
    const b = makeNewLand(12, createSeededRng(123));
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("異なる seed では異なる地形になりうる", () => {
    const a = makeNewLand(12, createSeededRng(1));
    const b = makeNewLand(12, createSeededRng(2));
    expect(a.toJSON()).not.toEqual(b.toJSON());
  });
});

describe("makeNewIsland", () => {
  it("完全な Island を返す (commands は commandMax 個の資金繰り、lbbs は空)", () => {
    const rng = createSeededRng(1);
    const island = makeNewIsland(defaultConfig, rng, {
      id: 5,
      name: "テスト島",
      ownerUserId: "owner-1",
    });

    expect(island.id).toBe(5);
    expect(island.name).toBe("テスト島");
    expect(island.ownerUserId).toBe("owner-1");
    expect(island.comment).toBe("(未登録)");
    expect(island.score).toBe(0);
    expect(island.absent).toBe(defaultConfig.giveupTurns - 3);
    expect(island.money).toBe(defaultConfig.initialMoney);
    expect(island.food).toBe(defaultConfig.initialFood);
    expect(island.pop).toBe(0);
    expect(island.area).toBe(0);
    expect(island.farm).toBe(0);
    expect(island.factory).toBe(0);
    expect(island.mountain).toBe(0);
    expect(island.prize).toEqual({ flags: 0, monsters: 0, turns: [] });
    expect(island.lbbs).toEqual([]);
    expect(island.commands).toHaveLength(defaultConfig.commandMax);
    for (const command of island.commands) {
      expect(command).toEqual(doNothingCommand);
    }
  });

  it("commands は独立したコピーであり、1件書き換えても他に影響しない", () => {
    const island = makeNewIsland(defaultConfig, createSeededRng(1), {
      id: 1,
      name: "島",
      ownerUserId: "owner-1",
    });
    island.commands[0]!.x = 5;
    expect(island.commands[1]!.x).toBe(0);
  });
});

describe("estimate", () => {
  it("手作りの地形から pop/area/farm/factory/mountain を正しく再計算する", () => {
    const terrain = createTerrain(3);
    terrain.setKind(0, 0, LandKind.Sea, 0);
    terrain.setKind(1, 0, LandKind.Town, 30);
    terrain.setKind(2, 0, LandKind.Town, 20);
    terrain.setKind(0, 1, LandKind.Farm, 5);
    terrain.setKind(1, 1, LandKind.Factory, 7);
    terrain.setKind(2, 1, LandKind.Mountain, 3);
    terrain.setKind(0, 2, LandKind.Sbase, 0);
    terrain.setKind(1, 2, LandKind.Oil, 0);
    terrain.setKind(2, 2, LandKind.Waste, 0);

    const island = makeNewIsland(defaultConfig, createSeededRng(1), {
      id: 1,
      name: "島",
      ownerUserId: "owner-1",
    });
    island.terrain = terrain;
    estimate(island);

    expect(island.pop).toBe(50); // 30 + 20
    expect(island.farm).toBe(5);
    expect(island.factory).toBe(7);
    expect(island.mountain).toBe(3);
    // area: 海・海底基地・油田を除く数 = 9 - (Sea 1 + Sbase 1 + Oil 1) = 6
    expect(island.area).toBe(6);
  });

  it("全て海の場合はすべて0になる", () => {
    const terrain = createTerrain(2);
    const island = makeNewIsland(defaultConfig, createSeededRng(1), {
      id: 1,
      name: "島",
      ownerUserId: "owner-1",
    });
    island.terrain = terrain;
    estimate(island);
    expect(island.pop).toBe(0);
    expect(island.area).toBe(0);
    expect(island.farm).toBe(0);
    expect(island.factory).toBe(0);
    expect(island.mountain).toBe(0);
  });
});
