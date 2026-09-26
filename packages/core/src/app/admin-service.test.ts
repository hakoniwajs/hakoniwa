import { describe, expect, it } from "vitest";
import { defaultConfig } from "../core/config.ts";
import { createSeededRng } from "../core/rng.ts";
import { makeTestIsland } from "../core/test-helpers.ts";
import { AdminService } from "./admin-service.ts";
import { AuthMethodPolicy } from "./auth-methods.ts";
import { AppError } from "./errors.ts";
import {
  FakeBackupStore,
  FakeClock,
  FakeGameRepository,
  FakeLogger,
  FakeSettingsRepository,
} from "./fake-repository.ts";
import type { GameMeta, GameRepository } from "./ports.ts";
import { TurnService } from "./turn-service.ts";

function setup() {
  const repo = new FakeGameRepository();
  const backupStore = new FakeBackupStore();
  const clock = new FakeClock(1_000_000);
  const turnService = new TurnService({
    repo,
    config: defaultConfig,
    rng: createSeededRng(1),
    backupStore,
    logger: new FakeLogger(),
  });
  const settings = new FakeSettingsRepository();
  const authMethods = new AuthMethodPolicy({
    configured: { x: true, discord: true, email: true },
    settings,
  });
  const admin = new AdminService({
    repo,
    clock,
    config: defaultConfig,
    backupStore,
    turnService,
    authMethods,
    mailerIsConsole: true,
  });
  return { repo, backupStore, clock, turnService, admin, authMethods };
}

/** 現在のゲームの GameMeta を取得する (無ければ Error)。 */
function currentMeta(repo: GameRepository): GameMeta {
  const gameId = repo.getCurrentGameId();
  if (gameId === undefined) {
    throw new Error("currentMeta: no current game");
  }
  return repo.getMeta(gameId);
}

function appErrorKind(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof AppError ? err.kind : undefined;
  }
}

describe("AdminService.initialize", () => {
  // tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: 新しいゲームは
  // turn=0 (開始前)、firstTurn=0 で作られる。
  it("turn=0, firstTurn=0, nextIslandId=1、lastTime は unitTimeSec で切り下げる", () => {
    const { repo, admin } = setup();
    const now = defaultConfig.unitTimeSec * 3 + 123;

    admin.initialize(now);

    expect(repo.isInitialized()).toBe(true);
    const meta = currentMeta(repo);
    expect(meta.turn).toBe(0);
    expect(meta.firstTurn).toBe(0);
    expect(meta.nextIslandId).toBe(1);
    expect(meta.lastTime).toBe(defaultConfig.unitTimeSec * 3);
  });

  // tmp/18-games.md「CLI」節: db init は「ゲームが無いときだけ game new」。ゲームが 1 つでも
  // あれば (running/finished を問わず) 失敗する。
  it("既にゲームがあれば (running でも finished でも) AppError('game_running') で失敗する", () => {
    const { repo, admin } = setup();
    admin.initialize(0);

    expect(appErrorKind(() => admin.initialize(defaultConfig.unitTimeSec))).toBe("game_running");

    admin.finishCurrentGame(1000);
    expect(appErrorKind(() => admin.initialize(2000))).toBe("game_running");
    // ゲームの中身自体は変わっていない。
    expect(repo.listGames()).toHaveLength(1);
  });

  it("tmp/16-season.md: startAt を指定すると、切り下げずそのまま lastTime/startAt になる", () => {
    const { repo, admin } = setup();
    const now = defaultConfig.unitTimeSec * 3 + 123;

    admin.initialize(now, { startAt: 999 });

    const meta = currentMeta(repo);
    expect(meta.lastTime).toBe(999);
    expect(meta.startAt).toBe(999);
  });

  it("tmp/16-season.md: finalTurn を指定すると保存される。省略時は null (無期限)", () => {
    const { repo, admin } = setup();

    admin.initialize(0, { finalTurn: 42 });
    expect(currentMeta(repo).finalTurn).toBe(42);
  });

  it("finalTurn 省略時は null (無期限)", () => {
    const { repo, admin } = setup();

    admin.initialize(0);
    expect(currentMeta(repo).finalTurn).toBeNull();
  });

  it("tmp/16-season.md: unitTimeSec を指定すると保存され、その値で lastTime を切り下げる", () => {
    const { repo, admin } = setup();
    const now = 60 * 7 + 30;

    admin.initialize(now, { unitTimeSec: 60 });

    const meta = currentMeta(repo);
    expect(meta.unitTimeSec).toBe(60);
    expect(meta.lastTime).toBe(60 * 7);
    expect(meta.startAt).toBe(60 * 7);
  });

  it("tmp/16-season.md: unitTimeSec 省略時は config.unitTimeSec になる", () => {
    const { repo, admin } = setup();

    admin.initialize(0);

    expect(currentMeta(repo).unitTimeSec).toBe(defaultConfig.unitTimeSec);
  });

  it("名前省略時は「第 1 回」になる", () => {
    const { repo, admin } = setup();
    admin.initialize(0);
    expect(currentMeta(repo).name).toBe("第 1 回");
  });
});

// tmp/18-games.md「AdminService」節。
describe("AdminService.startGame", () => {
  it("現在のゲームが無ければ成功し、新しい gameId を返す", () => {
    const { repo, admin } = setup();
    const gameId = admin.startGame({}, 0);
    expect(gameId).toBe(1);
    expect(repo.getCurrentGameId()).toBe(gameId);
    expect(currentMeta(repo).status).toBe("running");
  });

  it("現在のゲームが running なら AppError('game_running') で失敗する", () => {
    const { admin } = setup();
    admin.startGame({}, 0);

    expect(appErrorKind(() => admin.startGame({}, 100))).toBe("game_running");
  });

  it("現在のゲームが finished なら成功し、新しいゲームが現在のゲームになる", () => {
    const { repo, admin } = setup();
    const game1 = admin.startGame({}, 0);
    admin.finishCurrentGame(1000);

    const game2 = admin.startGame({}, 2000);

    expect(game2).not.toBe(game1);
    expect(repo.getCurrentGameId()).toBe(game2);
    expect(repo.getMeta(game1).status).toBe("finished");
    expect(repo.getMeta(game2).status).toBe("running");
  });

  it("name 省略時は「第 N 回」(N は新しい gameId) になる", () => {
    const { repo, admin } = setup();
    const game1 = admin.startGame({}, 0);
    expect(repo.getMeta(game1).name).toBe(`第 ${game1} 回`);

    admin.finishCurrentGame(100);
    const game2 = admin.startGame({}, 200);
    expect(repo.getMeta(game2).name).toBe(`第 ${game2} 回`);
    expect(repo.getMeta(game2).name).not.toBe(repo.getMeta(game1).name);
  });

  it("name を指定すればそれが使われる", () => {
    const { repo, admin } = setup();
    const gameId = admin.startGame({ name: "特別回" }, 0);
    expect(repo.getMeta(gameId).name).toBe("特別回");
  });
});

// tmp/18-games.md「AdminService」節。
describe("AdminService.finishCurrentGame", () => {
  it("running なら status が finished になり、finishedAt が記録される", () => {
    const { repo, admin } = setup();
    const gameId = admin.startGame({}, 0);

    admin.finishCurrentGame(12345);

    const meta = repo.getMeta(gameId);
    expect(meta.status).toBe("finished");
    expect(meta.finishedAt).toBe(12345);
  });

  it("既に finished なら AppError('game_finished') で失敗する", () => {
    const { admin } = setup();
    admin.startGame({}, 0);
    admin.finishCurrentGame(100);

    expect(appErrorKind(() => admin.finishCurrentGame(200))).toBe("game_finished");
  });
});

// tmp/18-games.md「ルート」節 GET /games の元データ。
describe("AdminService.listGames", () => {
  it("現在 + 過去のゲームを新しい順に返す", () => {
    const { admin } = setup();
    const game1 = admin.startGame({ name: "第 1 回" }, 0);
    admin.finishCurrentGame(100);
    const game2 = admin.startGame({ name: "第 2 回" }, 200);

    const games = admin.listGames();
    expect(games.map((g) => g.id)).toEqual([game2, game1]);
    expect(games.map((g) => g.status)).toEqual(["running", "finished"]);
  });
});

describe("AdminService.setUnitTimeSec", () => {
  it("unitTimeSec だけを更新し、lastTime は変えない", () => {
    const { repo, admin } = setup();
    admin.initialize(0);
    const before = currentMeta(repo);

    admin.setUnitTimeSec(120);

    const after = currentMeta(repo);
    expect(after.unitTimeSec).toBe(120);
    expect(after.lastTime).toBe(before.lastTime);
    expect(after.turn).toBe(before.turn);
  });

  it("0 以下や非整数は Error", () => {
    const { admin } = setup();
    admin.initialize(0);
    expect(() => admin.setUnitTimeSec(0)).toThrow();
    expect(() => admin.setUnitTimeSec(-1)).toThrow();
    expect(() => admin.setUnitTimeSec(1.5)).toThrow();
  });
});

describe("AdminService.reset", () => {
  it("全データを削除し isInitialized が false になる", () => {
    const { repo, admin } = setup();
    admin.initialize(0);
    expect(repo.isInitialized()).toBe(true);

    admin.reset();

    expect(repo.isInitialized()).toBe(false);
  });
});

describe("AdminService.setLastTime", () => {
  // tmp/16-season.md「開始前の状態 = ターン 0」節「管理操作」: turn===0 (開始前) の間は
  // lastTime の変更が startAt にも追従する (開始前 → 進行中の切替に使う)。
  it("開始前 (turn===0): lastTime と一緒に startAt も更新される", () => {
    const { repo, admin } = setup();
    admin.initialize(0);

    admin.setLastTime(123456);

    const meta = currentMeta(repo);
    expect(meta.lastTime).toBe(123456);
    expect(meta.startAt).toBe(123456);
    expect(meta.turn).toBe(0);
  });

  it("進行中 (turn>=1): lastTime だけを更新し、startAt は変えない", () => {
    const { repo, admin } = setup();
    admin.initialize(0);
    admin.advanceTurn(0);
    const before = currentMeta(repo);
    expect(before.turn).toBe(1);

    admin.setLastTime(123456);

    const meta = currentMeta(repo);
    expect(meta.lastTime).toBe(123456);
    expect(meta.startAt).toBe(before.startAt);
    expect(meta.turn).toBe(1);
  });
});

describe("AdminService.status", () => {
  it("未初期化なら initialized: false を返す", async () => {
    const { admin } = setup();
    const status = await admin.status();
    expect(status.initialized).toBe(false);
    expect(status.backups).toEqual([]);
    expect(status.games).toEqual([]);
  });

  it("初期化後は turn/lastTime/現在のゲーム情報を返す", async () => {
    const { admin } = setup();
    const gameId = admin.startGame({ name: "第 1 回" }, 0);
    const status = await admin.status();
    expect(status.initialized).toBe(true);
    expect(status.turn).toBe(0);
    expect(status.gameId).toBe(gameId);
    expect(status.gameName).toBe("第 1 回");
    expect(status.gameStatus).toBe("running");
    expect(status.games).toHaveLength(1);
  });

  it("tmp/16-season.md: season.unitTimeSec は config ではなく meta の値を返す", async () => {
    const { admin } = setup();
    admin.initialize(0, { unitTimeSec: 60 });
    admin.setUnitTimeSec(120);
    const status = await admin.status();
    expect(status.season?.unitTimeSec).toBe(120);
  });
});

describe("AdminService バックアップ操作", () => {
  it("作成・一覧・削除ができる", async () => {
    const { admin } = setup();
    admin.initialize(0);

    await admin.createBackup("manual-1");
    let backups = await admin.listBackups();
    expect(backups.map((b) => b.label)).toContain("manual-1");

    await admin.deleteBackup("manual-1");
    backups = await admin.listBackups();
    expect(backups.map((b) => b.label)).not.toContain("manual-1");
  });

  it("復元は BackupStore に委譲される", async () => {
    const { admin, backupStore } = setup();
    admin.initialize(0);
    await admin.createBackup("manual-1");

    await expect(admin.restoreBackup("manual-1")).resolves.toBeUndefined();
    await expect(admin.restoreBackup("does-not-exist")).rejects.toThrow();
    void backupStore;
  });
});

describe("AdminService.advanceTurn", () => {
  it("TurnService.advanceTurn に委譲する", () => {
    const { repo, admin } = setup();
    admin.initialize(0);

    admin.advanceTurn(0);

    expect(currentMeta(repo).turn).toBe(1);
  });
});

describe("AdminService.maximizeIsland", () => {
  it("資金と食料を9999にする", () => {
    const { repo, admin } = setup();
    const gameId = admin.startGame({}, 0);
    const island = makeTestIsland({ id: 1, money: 10, food: 10 });
    repo.insertIsland(gameId, island, 0);

    admin.maximizeIsland(1);

    const updated = repo.findIsland(gameId, 1);
    expect(updated?.money).toBe(9999);
    expect(updated?.food).toBe(9999);
  });

  it("存在しない島は Error", () => {
    const { admin } = setup();
    admin.initialize(0);
    expect(() => admin.maximizeIsland(999)).toThrow();
  });
});

describe("AdminService.getAuthMethods / setAuthMethods", () => {
  it("既定はすべて有効、mailerIsConsole を含む", () => {
    const { admin } = setup();
    expect(admin.getAuthMethods()).toEqual({
      configured: { x: true, discord: true, email: true },
      enabled: { x: true, discord: true, email: true },
      mailerIsConsole: true,
    });
  });

  it("setAuthMethods で切り替えると getAuthMethods に反映される", () => {
    const { admin } = setup();
    admin.setAuthMethods({ x: false, discord: true, email: true });
    expect(admin.getAuthMethods().enabled).toEqual({ x: false, discord: true, email: true });
  });
});
