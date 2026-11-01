import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../config.ts";
import { makeTestIsland } from "../test-helpers.ts";
import { income } from "./income.ts";

describe("income", () => {
  it("農場に余剰がある場合: food += farm*10, money += min((pop-farm*10)/10, factory+mountain)", () => {
    const island = makeTestIsland({
      pop: 100,
      farm: 5, // farm*10 = 50
      factory: 3,
      mountain: 1,
      food: 0,
      money: 0,
    });
    income(island, defaultConfig);
    // food = int(50 - 100*0.2) = int(50-20) = 30
    expect(island.food).toBe(30);
    // money += min(int((100-50)/10), 3+1) = min(5,4) = 4
    expect(island.money).toBe(4);
  });

  it("農場だけで手一杯の場合 (pop <= farm*10): food += pop, money は変わらない", () => {
    const island = makeTestIsland({
      pop: 40,
      farm: 5, // farm*10 = 50 >= pop
      factory: 10,
      mountain: 10,
      food: 0,
      money: 100,
    });
    income(island, defaultConfig);
    // food = int(40 - 40*0.2) = int(40-8) = 32
    expect(island.food).toBe(32);
    expect(island.money).toBe(100);
  });

  it("食料消費は int(food - pop*eatenFood) の順で計算する (丸めの確認)", () => {
    const island = makeTestIsland({
      pop: 7,
      farm: 0,
      factory: 0,
      mountain: 0,
      food: 10,
      money: 0,
    });
    income(island, defaultConfig);
    // pop(7) > farm*10(0) -> food += 0 (farm) => food=10, money += min(int(7/10),0)=0
    // food = int(10 - 7*0.2) = int(10-1.4) = int(8.6) = 8
    expect(island.food).toBe(8);
    expect(island.money).toBe(0);
  });

  it("食料が不足していれば負の値になりうる (int は 0 方向への切り捨て)", () => {
    const island = makeTestIsland({
      pop: 100,
      farm: 0,
      factory: 0,
      mountain: 0,
      food: 5,
      money: 0,
    });
    income(island, defaultConfig);
    // pop(100) > farm*10(0) -> food += 0 => food=5
    // food = int(5 - 100*0.2) = int(5-20) = int(-15) = -15
    expect(island.food).toBe(-15);
  });
});
