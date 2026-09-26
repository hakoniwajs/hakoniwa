// 実 DB (:memory:) + buildDeps で GameService/TurnService を結合テストする。
import {
  buildDeps,
  defaultSiteSettings,
  CommandKind,
  createSeededRng,
  defaultConfig,
  FakeBackupStore,
  FakeClock,
  LandKind,
  migrate,
} from "@hakoniwajs/core";
import type { AppConfig, AuthUser, Point, Terrain } from "@hakoniwajs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../src/driver.ts";

function user(id: string): AuthUser {
  return { id, name: `user-${id}`, email: `${id}@example.com`, isAdmin: false };
}

function setup(
  overrides: Partial<typeof defaultConfig> = {},
  initOptions: { startAt?: number } = {},
) {
  const driver = new NodeSqliteDriver(":memory:");
  migrate(driver);
  const clock = new FakeClock(0);
  const backupStore = new FakeBackupStore();
  const config: AppConfig = {
    game: { ...defaultConfig, ...overrides, maxCatchUpTurns: 10 },
    auth: {
      baseUrl: "http://localhost:5173",
      secret: "test-secret",
      devLogin: false,
      adminEmails: [],
    },
    mail: { mailFrom: "hakoniwa@example.com" },
    adminEnabled: true,
    debug: false,
    siteDefaults: defaultSiteSettings,
  };
  const deps = buildDeps({
    driver,
    backupStore,
    clock,
    config,
    rng: createSeededRng(42),
  });
  deps.adminService.initialize(clock.now(), initOptions);
  const gameId = deps.repo.getCurrentGameId();
  if (gameId === undefined) {
    throw new Error("unreachable: game not created");
  }
  return { driver, clock, backupStore, gameId, ...deps };
}

describe("turn-integration (実 DB)", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("createIsland で 2 島作成 → advanceTurn 数回で turn が進み、島が読み戻せる", () => {
    const { gameService, turnService, driver, gameId } = ctx;

    const created1 = gameService.createIsland(user("u1"), gameId, "島1");
    const created2 = gameService.createIsland(user("u2"), gameId, "島2");
    expect(created1.id).toBe(1);
    expect(created2.id).toBe(2);

    // tmp/16-season.md「開始前の状態 = ターン 0」節: 新しいゲームは turn=0 (開始前) で作られる。
    const before = driver.get<{ turn: number }>("SELECT turn FROM games WHERE id = ?", gameId);
    expect(before?.turn).toBe(0);

    turnService.advanceTurn(ctx.clock.now());
    turnService.advanceTurn(ctx.clock.now());
    turnService.advanceTurn(ctx.clock.now());

    const after = driver.get<{ turn: number }>("SELECT turn FROM games WHERE id = ?", gameId);
    expect(after?.turn).toBe(3);

    const top = gameService.getTopPage(undefined, gameId);
    expect(top.turn).toBe(3);
    expect(top.islands.map((i) => i.name).sort()).toEqual(["島1", "島2"]);
  });

  it("advanceTurnIfDue は期限が来るまで進まず、期限が来ると maxCatchUpTurns まで進む", () => {
    // tmp/16-season.md「開始前の状態 = ターン 0」節: turn=0 の期限判定は `now >= startAt` のみで
    // 判定する (省略時の startAt は現在時刻の切り下げなので即座に期限到来してしまう)。
    // 「期限前は進まない」を確かめるため、startAt を明示的に未来にする。
    const startAt = defaultConfig.unitTimeSec;
    const localCtx = setup({}, { startAt });
    const { turnService, clock, driver, gameId } = localCtx;

    // startAt 前は進まない。
    expect(turnService.advanceTurnIfDue(clock.now())).toBe(0);

    // startAt 到達 (turn 0→1) 後、さらに 2 ターン分の期限が来ている状態にする。
    clock.advance(startAt + defaultConfig.unitTimeSec * 2);
    const advanced = turnService.advanceTurnIfDue(clock.now());
    expect(advanced).toBe(3);

    const meta = driver.get<{ turn: number }>("SELECT turn FROM games WHERE id = ?", gameId);
    expect(meta?.turn).toBe(3);
  });

  it("発見時の history はターン処理をまたいでも読み出せる (repo 経由の永続化確認)", () => {
    const { gameService, turnService, clock, gameId } = ctx;
    gameService.createIsland(user("u1"), gameId, "島1");

    turnService.advanceTurn(clock.now());

    const top = gameService.getTopPage(undefined, gameId);
    // 発見ログが history に記録され、ターン処理後も残っている。
    expect(top.history.some((h) => h.html.includes("島1"))).toBe(true);
  });

  it("最終ターン到達で status が finished になり、それ以降ターンが進まない (tmp/18-games.md)", () => {
    const driver = new NodeSqliteDriver(":memory:");
    migrate(driver);
    const clock = new FakeClock(0);
    const backupStore = new FakeBackupStore();
    const config: AppConfig = {
      game: { ...defaultConfig, maxCatchUpTurns: 10 },
      auth: {
        baseUrl: "http://localhost:5173",
        secret: "test-secret",
        devLogin: false,
        adminEmails: [],
      },
      mail: { mailFrom: "hakoniwa@example.com" },
      adminEnabled: true,
      debug: false,
      siteDefaults: defaultSiteSettings,
    };
    const deps = buildDeps({ driver, backupStore, clock, config, rng: createSeededRng(42) });
    deps.adminService.initialize(clock.now(), { finalTurn: 2 });
    const gameId = deps.repo.getCurrentGameId();
    if (gameId === undefined) throw new Error("unreachable");

    // tmp/16-season.md「開始前の状態 = ターン 0」節: 新しいゲームは turn=0 で始まるため、
    // finalTurn=2 は 2 回の処理 (turn=2) で終了する。
    deps.turnService.advanceTurn(clock.now());
    expect(deps.repo.getMeta(gameId).status).toBe("running");
    deps.turnService.advanceTurn(clock.now());
    const meta = deps.repo.getMeta(gameId);
    expect(meta.turn).toBe(2);
    expect(meta.status).toBe("finished");
    expect(meta.finishedAt).not.toBeNull();

    // それ以降は進まない。
    deps.turnService.advanceTurn(clock.now());
    expect(deps.repo.getMeta(gameId).turn).toBe(2);
    expect(deps.turnService.advanceTurnIfDue(clock.now() + 100000)).toBe(0);
  });

  // 「整地自動入力」「地ならし自動入力」の回帰テスト: registerCommand で AutoPrepare/AutoPrepare2
  // (kind 61/62) を登録した際、実行可能な計画 (Prepare/Prepare2) に変換されずそのまま保存される
  // と、turn/command.ts の switch に該当 case が無く "consumed" に落ちて何も実行されない
  // (荒地が整地されず、所持金も減らない) バグがあった。ここでは実際に GameService.registerCommand
  // → TurnService.advanceTurn を実行し、地形と所持金の変化まで確認する。
  //
  // disaster 系の確率はすべて 0 にする: 整地には 1% (disaster.maizo) の埋蔵金付与があり、
  // 隕石・噴火等は座標が完全にランダムで対象ヘックスの種別を問わないため、確率を残したままだと
  // rng の消費順序次第で所持金・地形の期待値が揺れてしまう (シード固定でも回帰テストとして
  // 脆くなる) ため。
  /**
   * createIsland が作る地形 (makeNewLand) は乱数で荒地が残る場合があり、テスト側で指定した
   * 座標以外にも荒地が残っていると「整地自動入力」がその荒地まで拾ってしまい、実行対象の座標
   * や個数が期待通りにならない。町・森・山・基地はそのまま残し (pop を保つため)、荒地だけを
   * 平地に均してから、テストで狙った座標だけを荒地にし直す。
   */
  function resetWasteToOnly(terrain: Terrain, points: Point[]): void {
    for (let y = 0; y < terrain.size; y++) {
      for (let x = 0; x < terrain.size; x++) {
        if (terrain.get(x, y).kind === LandKind.Waste) {
          terrain.setKind(x, y, LandKind.Plains, 0);
        }
      }
    }
    for (const { x, y } of points) {
      terrain.setKind(x, y, LandKind.Waste, 0);
    }
  }

  const noDisasterOverrides: Partial<typeof defaultConfig> = {
    disaster: {
      ...defaultConfig.disaster,
      earthquake: 0,
      tsunami: 0,
      typhoon: 0,
      meteo: 0,
      hugeMeteo: 0,
      eruption: 0,
      fire: 0,
      maizo: 0,
      falldown: 0,
      monster: 0,
    },
  };

  it("整地自動入力 (AutoPrepare): 登録した計画が 1 ターンで実行され、荒地が減り所持金が 5 減る", () => {
    const { gameService, turnService, repo, clock, gameId } = setup(noDisasterOverrides);

    gameService.createIsland(user("u1"), gameId, "島1");
    const summary = repo.findIslandByOwner(gameId, "u1");
    if (summary === undefined) throw new Error("island not found");
    const island = repo.findIsland(gameId, summary.id);
    if (island === undefined) throw new Error("island not found");
    // createIsland が作った地形 (中心部に町・森・山・基地を含む。pop > 0) はそのまま残し
    // (テラインを丸ごと差し替えると pop が 0 になり、ターン処理の死滅判定で島ごと消えてしまう)、
    // 荒地だけ島の隅の 1 マスに絞る。
    resetWasteToOnly(island.terrain, [{ x: 0, y: 0 }]);
    repo.updateIsland(gameId, island);

    gameService.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.AutoPrepare,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });

    const before = repo.findIsland(gameId, summary.id);
    if (before === undefined) throw new Error("island not found");
    // 登録された計画の kind が AutoPrepare(61) のままではなく、実行可能な Prepare(1) であること。
    expect(before.commands[0]?.kind).toBe(CommandKind.Prepare);
    const moneyBefore = before.money;

    turnService.advanceTurn(clock.now());

    const after = repo.findIsland(gameId, summary.id);
    if (after === undefined) throw new Error("island not found");
    expect(after.terrain.get(0, 0).kind).toBe(LandKind.Plains);
    expect(after.money).toBe(moneyBefore - 5);
  });

  it("地ならし自動入力 (AutoPrepare2): 登録した計画が 1 ターンでまとめて実行され (continue)、荒地が全て減り所持金が 100×実行数 減る", () => {
    const { gameService, turnService, repo, clock, gameId } = setup(noDisasterOverrides);

    gameService.createIsland(user("u1"), gameId, "島1");
    const summary = repo.findIslandByOwner(gameId, "u1");
    if (summary === undefined) throw new Error("island not found");
    const island = repo.findIsland(gameId, summary.id);
    if (island === undefined) throw new Error("island not found");
    // createIsland が作った地形 (pop > 0) はそのまま残し、荒地は島の隅の数マスだけに絞る。
    const wastePoints = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    resetWasteToOnly(island.terrain, wastePoints);
    // 地ならし (cost 100) を複数回実行できるだけの所持金を用意する。
    island.money = 1000;
    repo.updateIsland(gameId, island);

    gameService.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.AutoPrepare2,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });

    const before = repo.findIsland(gameId, summary.id);
    if (before === undefined) throw new Error("island not found");
    const registered = before.commands.filter((c) => c.kind === CommandKind.Prepare2);
    expect(registered).toHaveLength(wastePoints.length);
    const moneyBefore = before.money;

    // 地ならしは doPrepare が "continue" を返すため、1 回の advanceTurn で登録された分がまとめて
    // 実行される。
    turnService.advanceTurn(clock.now());

    const after = repo.findIsland(gameId, summary.id);
    if (after === undefined) throw new Error("island not found");
    for (const { x, y } of wastePoints) {
      expect(after.terrain.get(x, y).kind).toBe(LandKind.Plains);
    }
    // 登録した地ならし (cost 100) 3 件が同一ターン内でまとめて実行された後、doCommand の
    // while ループはキューの続き (資金繰り = DoNothing) も "consumed" になるまで処理するため、
    // 資金繰り 1 回分の money+=10 も同じターンに乗る (command.ts の仕様通り)。
    expect(after.money).toBe(moneyBefore - 100 * wastePoints.length + 10);
  });
});
