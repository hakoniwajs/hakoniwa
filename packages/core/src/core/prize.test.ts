import { describe, expect, it } from "vite-plus/test";
import { monsters, PrizeFlag, prizeNames } from "./constants.ts";
import {
  flagPrizes,
  hasFlag,
  killedMonsters,
  turnPrizes,
  withFlag,
  withMonster,
  withTurnPrize,
} from "./prize.ts";
import type { Prize } from "./types.ts";

function emptyPrize(): Prize {
  return { flags: 0, monsters: 0, turns: [] };
}

describe("hasFlag / withFlag", () => {
  it("フラグが立っていなければ false", () => {
    expect(hasFlag(emptyPrize(), PrizeFlag.Prosperity1)).toBe(false);
  });

  it("withFlag はフラグを立てた新しいオブジェクトを返す (不変)", () => {
    const prize = emptyPrize();
    const updated = withFlag(prize, PrizeFlag.Prosperity1);
    expect(hasFlag(updated, PrizeFlag.Prosperity1)).toBe(true);
    expect(hasFlag(prize, PrizeFlag.Prosperity1)).toBe(false); // 元は変更されない
    expect(updated).not.toBe(prize);
  });

  it("複数のフラグを重ねて立てられる", () => {
    let prize = emptyPrize();
    prize = withFlag(prize, PrizeFlag.Prosperity1);
    prize = withFlag(prize, PrizeFlag.Disaster1);
    expect(hasFlag(prize, PrizeFlag.Prosperity1)).toBe(true);
    expect(hasFlag(prize, PrizeFlag.Disaster1)).toBe(true);
    expect(hasFlag(prize, PrizeFlag.Peace1)).toBe(false);
    expect(prize.flags).toBe(PrizeFlag.Prosperity1 | PrizeFlag.Disaster1);
  });
});

describe("withMonster / killedMonsters", () => {
  it("怪獣種別のビットを立てる", () => {
    const prize = withMonster(emptyPrize(), 2);
    expect(prize.monsters).toBe(1 << 2);
  });

  it("killedMonsters: 何も倒していなければ maxKind=-1, names=[]", () => {
    expect(killedMonsters(emptyPrize())).toEqual({ maxKind: -1, names: [] });
  });

  it("killedMonsters: 倒した怪獣の名前一覧と最大種別を返す", () => {
    let prize = emptyPrize();
    prize = withMonster(prize, 0);
    prize = withMonster(prize, 3);
    const result = killedMonsters(prize);
    expect(result.maxKind).toBe(3);
    expect(result.names).toEqual([monsters[0]!.name, monsters[3]!.name]);
  });
});

describe("withTurnPrize / turnPrizes", () => {
  it("ターンを追加できる (不変)", () => {
    const prize = emptyPrize();
    const updated = withTurnPrize(prize, 100);
    expect(turnPrizes(updated)).toEqual([100]);
    expect(turnPrizes(prize)).toEqual([]);
  });

  it("複数回追加すると順番に積み上がる", () => {
    let prize = emptyPrize();
    prize = withTurnPrize(prize, 100);
    prize = withTurnPrize(prize, 200);
    expect(turnPrizes(prize)).toEqual([100, 200]);
  });
});

describe("flagPrizes", () => {
  it("フラグが立っていなければ空配列", () => {
    expect(flagPrizes(emptyPrize())).toEqual([]);
  });

  it("立っているフラグを index (1..9) 順に賞名・画像に変換する", () => {
    let prize = emptyPrize();
    prize = withFlag(prize, PrizeFlag.Prosperity1); // index 1
    prize = withFlag(prize, PrizeFlag.Disaster3); // index 9
    const result = flagPrizes(prize);
    expect(result).toEqual([
      { index: 1, name: prizeNames[1], image: "prize1.gif" },
      { index: 9, name: prizeNames[9], image: "prize9.gif" },
    ]);
  });
});
