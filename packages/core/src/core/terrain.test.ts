import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "./config.ts";
import { LandKind } from "./constants.ts";
import {
  createTerrain,
  expToLevel,
  isHardened,
  landName,
  monsterSpec,
  terrainFromJSON,
} from "./terrain.ts";

describe("createTerrain / toJSON / terrainFromJSON", () => {
  it("デフォルトはすべて海 (kind=0, value=0)", () => {
    const terrain = createTerrain(2);
    expect(terrain.toJSON()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it("get/set の範囲外は throw する", () => {
    const terrain = createTerrain(2);
    expect(() => terrain.get(-1, 0)).toThrow();
    expect(() => terrain.get(0, 2)).toThrow();
    expect(() => terrain.set(2, 0, { kind: LandKind.Sea, value: 0 })).toThrow();
  });

  it("setKind で更新でき、get で取得できる", () => {
    const terrain = createTerrain(3);
    terrain.setKind(1, 2, LandKind.Forest, 3);
    expect(terrain.get(1, 2)).toEqual({ kind: LandKind.Forest, value: 3 });
  });

  it("clone は独立したコピーを返す", () => {
    const terrain = createTerrain(2);
    const cloned = terrain.clone();
    cloned.setKind(0, 0, LandKind.Town, 5);
    expect(terrain.get(0, 0)).toEqual({ kind: LandKind.Sea, value: 0 });
    expect(cloned.get(0, 0)).toEqual({ kind: LandKind.Town, value: 5 });
  });

  it("toJSON → terrainFromJSON の round-trip", () => {
    const terrain = createTerrain(3);
    terrain.setKind(0, 0, LandKind.Waste, 0);
    terrain.setKind(1, 1, LandKind.Town, 50);
    terrain.setKind(2, 2, LandKind.Monster, 12);
    const json = terrain.toJSON();
    const restored = terrainFromJSON(3, json);
    expect(restored.toJSON()).toEqual(json);
    expect(restored.get(1, 1)).toEqual({ kind: LandKind.Town, value: 50 });
  });

  it("cells の長さが size*size と異なる場合は reject する", () => {
    expect(() => terrainFromJSON(2, [[0, 0]])).toThrow();
  });

  it("kind が LandKind の範囲外の場合は reject する", () => {
    const cells = Array.from({ length: 4 }, () => [99, 0]);
    expect(() => terrainFromJSON(2, cells)).toThrow();
  });

  it("value が 0..255 の範囲外の場合は reject する", () => {
    const cells = Array.from({ length: 4 }, () => [0, 0]);
    cells[0] = [0, 256];
    expect(() => terrainFromJSON(2, cells)).toThrow();
    cells[0] = [0, -1];
    expect(() => terrainFromJSON(2, cells)).toThrow();
  });

  it("セルの要素数が2でない場合は reject する", () => {
    expect(() => terrainFromJSON(1, [[0]])).toThrow();
  });
});

describe("landName", () => {
  it('海 (value=0) は "海"、浅瀬 (value=1) は "浅瀬"', () => {
    expect(landName({ kind: LandKind.Sea, value: 0 })).toBe("海");
    expect(landName({ kind: LandKind.Sea, value: 1 })).toBe("浅瀬");
  });

  it("荒地・平地・森・農場・工場・ミサイル基地・防衛施設・山・海底基地・海底油田・ハリボテ", () => {
    expect(landName({ kind: LandKind.Waste, value: 0 })).toBe("荒地");
    expect(landName({ kind: LandKind.Plains, value: 0 })).toBe("平地");
    expect(landName({ kind: LandKind.Forest, value: 0 })).toBe("森");
    expect(landName({ kind: LandKind.Farm, value: 0 })).toBe("農場");
    expect(landName({ kind: LandKind.Factory, value: 0 })).toBe("工場");
    expect(landName({ kind: LandKind.Base, value: 0 })).toBe("ミサイル基地");
    expect(landName({ kind: LandKind.Defence, value: 0 })).toBe("防衛施設");
    expect(landName({ kind: LandKind.Mountain, value: 0 })).toBe("山");
    expect(landName({ kind: LandKind.Sbase, value: 0 })).toBe("海底基地");
    expect(landName({ kind: LandKind.Oil, value: 0 })).toBe("海底油田");
    expect(landName({ kind: LandKind.Haribote, value: 0 })).toBe("ハリボテ");
  });

  it("町は value に応じて 村/町/都市 に分岐する", () => {
    expect(landName({ kind: LandKind.Town, value: 29 })).toBe("村");
    expect(landName({ kind: LandKind.Town, value: 30 })).toBe("町");
    expect(landName({ kind: LandKind.Town, value: 99 })).toBe("町");
    expect(landName({ kind: LandKind.Town, value: 100 })).toBe("都市");
  });

  it("怪獣は monsterSpec の名前を使う", () => {
    // value=12 -> kind=1 (いのら), hp=2
    expect(landName({ kind: LandKind.Monster, value: 12 })).toBe("いのら");
  });

  it("記念碑は monuments[value] の名前を使う", () => {
    expect(landName({ kind: LandKind.Monument, value: 0 })).toBe("モノリス");
    expect(landName({ kind: LandKind.Monument, value: 1 })).toBe("平和記念碑");
    expect(landName({ kind: LandKind.Monument, value: 2 })).toBe("戦いの碑");
  });
});

describe("monsterSpec", () => {
  it("value を10で割った商が種類、余りが体力", () => {
    expect(monsterSpec(23)).toEqual({ kind: 2, name: "サンジラ", hp: 3 });
    expect(monsterSpec(70)).toEqual({ kind: 7, name: "キングいのら", hp: 0 });
  });
});

describe("expToLevel", () => {
  it("ミサイル基地 (Base) は baseLevelUp の境界値で判定する", () => {
    expect(expToLevel(LandKind.Base, 0, defaultConfig)).toBe(1);
    expect(expToLevel(LandKind.Base, 19, defaultConfig)).toBe(1);
    expect(expToLevel(LandKind.Base, 20, defaultConfig)).toBe(2);
    expect(expToLevel(LandKind.Base, 59, defaultConfig)).toBe(2);
    expect(expToLevel(LandKind.Base, 60, defaultConfig)).toBe(3);
    expect(expToLevel(LandKind.Base, 119, defaultConfig)).toBe(3);
    expect(expToLevel(LandKind.Base, 120, defaultConfig)).toBe(4);
    expect(expToLevel(LandKind.Base, 199, defaultConfig)).toBe(4);
    expect(expToLevel(LandKind.Base, 200, defaultConfig)).toBe(5);
    expect(expToLevel(LandKind.Base, 999, defaultConfig)).toBe(5);
  });

  it("海底基地 (Sbase) は sBaseLevelUp の境界値で判定する", () => {
    expect(expToLevel(LandKind.Sbase, 0, defaultConfig)).toBe(1);
    expect(expToLevel(LandKind.Sbase, 49, defaultConfig)).toBe(1);
    expect(expToLevel(LandKind.Sbase, 50, defaultConfig)).toBe(2);
    expect(expToLevel(LandKind.Sbase, 199, defaultConfig)).toBe(2);
    expect(expToLevel(LandKind.Sbase, 200, defaultConfig)).toBe(3);
  });
});

describe("isHardened", () => {
  it("special=0 (特になし) は常に false", () => {
    expect(isHardened(0, 1)).toBe(false);
    expect(isHardened(0, 2)).toBe(false);
  });

  it("special=3 (サンジラ) は奇数ターンで硬化", () => {
    expect(isHardened(2, 1)).toBe(true);
    expect(isHardened(2, 2)).toBe(false);
  });

  it("special=4 (クジラ) は偶数ターンで硬化", () => {
    expect(isHardened(6, 2)).toBe(true);
    expect(isHardened(6, 1)).toBe(false);
  });
});
