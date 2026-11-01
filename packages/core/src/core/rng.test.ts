import { describe, expect, it } from "vite-plus/test";
import { createMathRandomRng, createSeededRng, randomArray } from "./rng.ts";

describe("createSeededRng", () => {
  it("同じ seed からは同じ乱数列を生成する", () => {
    const a = createSeededRng(12345);
    const b = createSeededRng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("異なる seed からは異なる乱数列を生成する", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() は 0 以上 1 未満", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int(n) は 0 以上 n 未満の整数を返す", () => {
    const rng = createSeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});

describe("createMathRandomRng", () => {
  it("Math.random ベースで 0 以上 1 未満を返す", () => {
    const rng = createMathRandomRng();
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe("randomArray", () => {
  it("0..n-1 の順列を返す", () => {
    const rng = createSeededRng(42);
    const result = randomArray(10, rng);
    expect(result).toHaveLength(10);
    expect([...result].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("n === 0 の場合は [0] を返す (Perl 互換)", () => {
    const rng = createSeededRng(1);
    expect(randomArray(0, rng)).toEqual([0]);
  });

  it("n === 1 の場合は [0] を返す", () => {
    const rng = createSeededRng(1);
    expect(randomArray(1, rng)).toEqual([0]);
  });
});
