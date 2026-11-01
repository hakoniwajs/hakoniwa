import { describe, expect, it } from "vite-plus/test";
import { makeTestIsland } from "../test-helpers.ts";
import { islandSort } from "./sort.ts";

describe("islandSort", () => {
  it("人口の降順に並べ替える", () => {
    const a = makeTestIsland({ id: 1, pop: 100 });
    const b = makeTestIsland({ id: 2, pop: 300 });
    const c = makeTestIsland({ id: 3, pop: 200 });

    const sorted = islandSort([a, b, c]);

    expect(sorted.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("人口が同じときは元の順序を保つ (安定ソート)", () => {
    const a = makeTestIsland({ id: 1, pop: 100 });
    const b = makeTestIsland({ id: 2, pop: 100 });
    const c = makeTestIsland({ id: 3, pop: 200 });
    const d = makeTestIsland({ id: 4, pop: 100 });

    const sorted = islandSort([a, b, c, d]);

    expect(sorted.map((i) => i.id)).toEqual([3, 1, 2, 4]);
  });

  it("元の配列を破壊しない", () => {
    const a = makeTestIsland({ id: 1, pop: 100 });
    const b = makeTestIsland({ id: 2, pop: 300 });
    const original = [a, b];

    islandSort(original);

    expect(original).toEqual([a, b]);
  });
});
