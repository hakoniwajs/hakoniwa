// tmp/21-kv-snapshot-cache.md「キャッシュ期間の区別」節の TTL 計算と、island の terrain の
// JSON 変換往復を単体でテストする。DO/Worker のエンドツーエンドな確認は
// snapshot-cache.test.ts で行う。
import { createTerrain } from "@hakoniwajs/core";
import type { IslandPageVM } from "@hakoniwajs/core";
import { describe, expect, it } from "vitest";
import {
  computeSnapshotTtl,
  fromIslandPageSnapshotVM,
  islandSnapshotKey,
  loadSnapshotTtlConfig,
  siteSnapshotKey,
  toIslandPageSnapshotVM,
  topSnapshotKey,
} from "../src/snapshot.ts";

describe("topSnapshotKey / islandSnapshotKey", () => {
  it("ターン数を含まない、ゲーム/島 ID ベースのキーになる", () => {
    expect(topSnapshotKey(3)).toBe("v1:3:top");
    expect(islandSnapshotKey(3, 7)).toBe("v1:3:island:7");
  });

  it("サイト設定はゲームに依らない 1 キーに置く", () => {
    expect(siteSnapshotKey()).toBe("v1:site");
  });
});

describe("toIslandPageSnapshotVM / fromIslandPageSnapshotVM", () => {
  it("terrain (Terrain インスタンス) を number[][] にして、また復元できる (往復一致)", () => {
    const terrain = createTerrain(12);
    terrain.setKind(2, 3, 6 /* LandKind.Town */, 42);
    const vm: IslandPageVM = {
      id: 1,
      name: "てすと",
      rank: 1,
      turn: 1,
      absent: 0,
      pop: 10,
      area: 5,
      food: 20,
      farm: 0,
      factory: 0,
      mountain: 0,
      comment: "",
      prize: { turnPrizes: [], flagPrizes: [], killedMonsters: { maxKind: -1, names: [] } },
      terrain,
      moneyDisplay: { mode: "hidden" },
      lbbs: [],
      logs: [],
      ogp: {
        description: "",
        imagePath: "/games/1/islands/1/ogp.png?turn=1",
        width: 800,
        height: 420,
      },
      game: { id: 1, name: "げーむ", status: "running", isCurrent: true },
    };

    const snapshot = toIslandPageSnapshotVM(vm);
    // terrain はクラスインスタンスではなく、JSON にそのままできる number[][] になる。
    expect(Array.isArray(snapshot.terrain)).toBe(true);
    expect(snapshot.terrain).toEqual(terrain.toJSON());
    // JSON を経由しても壊れないこと (KV には JSON.stringify/JSON.parse で出入りするため)。
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

    const restored = fromIslandPageSnapshotVM(roundTripped, 12);
    expect(restored.terrain.toJSON()).toEqual(terrain.toJSON());
    expect(restored.terrain.get(2, 3)).toEqual({ kind: 6, value: 42 });
    expect(restored.id).toBe(vm.id);
    expect(restored.name).toBe(vm.name);
  });
});

describe("loadSnapshotTtlConfig", () => {
  it("未設定なら既定値 (60 秒 / 30 日) になる", () => {
    expect(loadSnapshotTtlConfig({})).toEqual({ ttlSec: 60, ttlImmutableSec: 2592000 });
  });

  it("空文字列も未設定扱い (既定値) になる", () => {
    expect(
      loadSnapshotTtlConfig({
        HAKONIWA_SNAPSHOT_TTL_SEC: "",
        HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC: "",
      }),
    ).toEqual({ ttlSec: 60, ttlImmutableSec: 2592000 });
  });

  it("設定値をそのまま使う", () => {
    expect(
      loadSnapshotTtlConfig({
        HAKONIWA_SNAPSHOT_TTL_SEC: "120",
        HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC: "3600",
      }),
    ).toEqual({ ttlSec: 120, ttlImmutableSec: 3600 });
  });

  it("Workers KV の最小 TTL (60 秒) 未満を指定したら 60 に切り上げる", () => {
    expect(loadSnapshotTtlConfig({ HAKONIWA_SNAPSHOT_TTL_SEC: "1" })).toEqual({
      ttlSec: 60,
      ttlImmutableSec: 2592000,
    });
    expect(loadSnapshotTtlConfig({ HAKONIWA_SNAPSHOT_TTL_SEC: "0" })).toEqual({
      ttlSec: 60,
      ttlImmutableSec: 2592000,
    });
  });

  it("整数でない値は例外", () => {
    expect(() => loadSnapshotTtlConfig({ HAKONIWA_SNAPSHOT_TTL_SEC: "abc" })).toThrow();
    expect(() => loadSnapshotTtlConfig({ HAKONIWA_SNAPSHOT_TTL_SEC: "-1" })).toThrow();
  });
});

describe("computeSnapshotTtl (tmp/21-kv-snapshot-cache.md「キャッシュ期間の区別」節)", () => {
  const base = { now: 1_000_000, ttlSec: 60, ttlImmutableSec: 2_592_000 };

  it("過去のゲーム (isCurrent=false) は トップ・島ページとも長期 TTL", () => {
    for (const kind of ["top", "island"] as const) {
      expect(
        computeSnapshotTtl({
          ...base,
          kind,
          isCurrent: false,
          seasonState: "finished",
          nextTurnAt: null,
        }),
      ).toBe(base.ttlImmutableSec);
      // 過去のゲームは season.state に関わらず不変。
      expect(
        computeSnapshotTtl({
          ...base,
          kind,
          isCurrent: false,
          seasonState: "running",
          nextTurnAt: 1_000_100,
        }),
      ).toBe(base.ttlImmutableSec);
    }
  });

  it("現在のゲームで終了済みのトップは長期 TTL", () => {
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "top",
        isCurrent: true,
        seasonState: "finished",
        nextTurnAt: null,
      }),
    ).toBe(base.ttlImmutableSec);
  });

  it("現在のゲームで終了済みの島ページは短期 TTL (記帳が入りうるため)", () => {
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "island",
        isCurrent: true,
        seasonState: "finished",
        nextTurnAt: null,
      }),
    ).toBe(base.ttlSec);
  });

  it("進行中のゲームは短期 TTL。次のターンまでが短ければそちらを優先する", () => {
    // 残り 200 秒 (> 60 かつ < ttlSec=60 ではない) のケース: ttlSec (60) の方が小さいので 60。
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "top",
        isCurrent: true,
        seasonState: "running",
        nextTurnAt: base.now + 200,
      }),
    ).toBe(60);
    // 残り 30 秒 (ttlSec の 60 より短い) → 次のターンまでの秒数を優先しつつ、
    // Workers KV の最小 TTL (60 秒) 未満にはしない。
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "island",
        isCurrent: true,
        seasonState: "running",
        nextTurnAt: base.now + 30,
      }),
    ).toBe(60);
    // 既にターン境界を過ぎている (nextTurnAt <= now) 場合も 60 未満にはしない。
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "top",
        isCurrent: true,
        seasonState: "running",
        nextTurnAt: base.now - 10,
      }),
    ).toBe(60);
  });

  it("設定値の ttlSec が 60 より大きい場合、次のターンまでの秒数がそれより短ければ優先する", () => {
    expect(
      computeSnapshotTtl({
        ...base,
        ttlSec: 600,
        kind: "top",
        isCurrent: true,
        seasonState: "running",
        nextTurnAt: base.now + 90,
      }),
    ).toBe(90);
  });

  it("開始前 (before) はターン予定が無い (nextTurnAt=null) ので ttlSec をそのまま使う", () => {
    expect(
      computeSnapshotTtl({
        ...base,
        kind: "top",
        isCurrent: true,
        seasonState: "before",
        nextTurnAt: null,
      }),
    ).toBe(base.ttlSec);
  });
});
