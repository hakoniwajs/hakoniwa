import { describe, expect, it } from "vite-plus/test";
import { LandKind } from "./constants.ts";
import { createTerrain } from "./terrain.ts";
import { createSeededRng } from "./rng.ts";
import { countAround, inBounds, neighbor, neighbors, shuffledPoints } from "./geometry.ts";

describe("neighbor / neighbors", () => {
  it("中心 (i=0) は自分自身の座標を返す", () => {
    expect(neighbor({ x: 5, y: 5 }, 0)).toEqual({ x: 5, y: 5 });
  });

  it("偶数行 (y が偶数) は補正されない", () => {
    const p = { x: 5, y: 4 };
    const result = neighbors(p, 7).slice(1);
    expect(result).toEqual([
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 3 },
    ]);
  });

  it("奇数行 (y が奇数) は sx-- の補正が入る", () => {
    const p = { x: 5, y: 5 };
    const result = neighbors(p, 7).slice(1);
    expect(result).toEqual([
      { x: 5, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
    ]);
  });

  it("19 近傍まで返せる", () => {
    expect(neighbors({ x: 5, y: 5 }, 19)).toHaveLength(19);
  });
});

describe("inBounds", () => {
  it("範囲内 / 範囲外を判定する", () => {
    expect(inBounds({ x: 0, y: 0 }, 12)).toBe(true);
    expect(inBounds({ x: 11, y: 11 }, 12)).toBe(true);
    expect(inBounds({ x: -1, y: 0 }, 12)).toBe(false);
    expect(inBounds({ x: 0, y: 12 }, 12)).toBe(false);
  });
});

describe("countAround", () => {
  it("範囲内のみ数える (kind が Sea 以外)", () => {
    const terrain = createTerrain(3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        terrain.setKind(x, y, LandKind.Waste);
      }
    }
    // (0,0) の周囲7 (中心含む): 範囲内 4 マスすべて荒地、範囲外3マスは Waste としては数えない
    expect(countAround(terrain, { x: 0, y: 0 }, LandKind.Waste, 7)).toBe(4);
  });

  it("範囲外は kind === Sea のときだけ加算する", () => {
    const terrain = createTerrain(3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        terrain.setKind(x, y, LandKind.Waste);
      }
    }
    // (0,0) の周囲7: 範囲外3マスを海として加算、範囲内は荒地なので加算しない
    expect(countAround(terrain, { x: 0, y: 0 }, LandKind.Sea, 7)).toBe(3);
  });

  it("全マスが海なら中心+周囲すべて (範囲内海+範囲外海) を数える", () => {
    const terrain = createTerrain(3); // デフォルトは全て Sea
    expect(countAround(terrain, { x: 0, y: 0 }, LandKind.Sea, 7)).toBe(7);
  });
});

describe("shuffledPoints", () => {
  it("全 size*size 座標を 1 回ずつ含む", () => {
    const size = 12;
    const rng = createSeededRng(1);
    const points = shuffledPoints(size, rng);
    expect(points).toHaveLength(size * size);
    const seen = new Set(points.map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        expect(seen.has(`${x},${y}`)).toBe(true);
      }
    }
  });
});
