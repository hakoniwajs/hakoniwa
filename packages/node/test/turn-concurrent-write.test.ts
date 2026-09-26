// 実ファイルの NodeSqliteDriver + SqliteGameRepository + 別接続からの書き込みで、
// 「呼び出し元がトランザクション外で読んだ getMeta」と「進行トランザクションの BEGIN」の
// 間に別プロセス (CLI 等) のコミットが入る競合窓を再現する結合テスト。
// packages/node サーバと CLI が同じ SQLite ファイルを共有する構成で実際に起きうる窓。
// 修正前はこのケースで終了済みゲームが 'running' に復活し、final_turn が NULL に戻された。
import {
  buildDeps,
  defaultSiteSettings,
  createSeededRng,
  defaultConfig,
  FakeBackupStore,
  FakeClock,
  migrate,
} from "@hakoniwajs/core";
import type { AppConfig } from "@hakoniwajs/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../src/driver.ts";

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

// unitTimeSec=21600 → first advanceTurnIfDue lands exactly turn=1 (turn 0→1 only).
function setup(startAt: number, unitTimeSec: number) {
  dir = mkdtempSync(join(tmpdir(), "hakoniwa-e2e-"));
  const dbPath = join(dir, "test.sqlite");
  const driver = new NodeSqliteDriver(dbPath);
  migrate(driver);
  const clock = new FakeClock(0);
  const backupStore = new FakeBackupStore();
  const config: AppConfig = {
    game: { ...defaultConfig, unitTimeSec, maxCatchUpTurns: 10 },
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
  const now = Math.floor(Date.now() / 1000);
  const gameId = deps.adminService.startGame({ name: "E2E", startAt, unitTimeSec }, now);
  return { deps, driver, dbPath, gameId, now };
}

/**
 * Wrap `driver.transaction` so a SECOND real connection commits `write` between the
 * caller's outside-tx getMeta and the tx's BEGIN IMMEDIATE — the vulnerable window.
 */
function injectBeforeNextTransaction(
  driver: NodeSqliteDriver,
  dbPath: string,
  write: (other: NodeSqliteDriver) => void,
): void {
  const origTx = driver.transaction.bind(driver);
  let done = false;
  (driver as unknown as { transaction: <T>(fn: () => T) => T }).transaction = <T>(
    fn: () => T,
  ): T => {
    if (!done) {
      done = true;
      const other = new NodeSqliteDriver(dbPath);
      try {
        other.transaction(() => write(other));
      } finally {
        other.close();
      }
    }
    return origTx(fn);
  };
}

describe("e2e: concurrent write between getMeta and tx (real SQLite, 2nd connection)", () => {
  it("finish committed between getMeta and BEGIN → stays finished, turn frozen", () => {
    const { deps, driver, dbPath, gameId, now } = setup(0, 21600);
    deps.turnService.advanceTurnIfDue(1000); // turn 0→1 only (next due at 21600)
    const before = deps.repo.getMeta(gameId);
    expect(before.status).toBe("running");
    expect(before.turn).toBe(1);

    injectBeforeNextTransaction(driver, dbPath, (other) => {
      // same write as repo.finishGame / CLI `game finish`
      other.run("UPDATE games SET status='finished', finished_at=? WHERE id=?", now, gameId);
    });
    // advanceTurnIfDue at a due time — stale meta says running+due; fresh meta says finished.
    const advanced = deps.turnService.advanceTurnIfDue(100000);

    const after = deps.repo.getMeta(gameId);
    expect(advanced).toBe(0);
    expect(after.status).toBe("finished");
    expect(after.turn).toBe(1); // NOT resurrected / not advanced past finish
    expect(after.finishedAt).toBe(now);
    driver.close();
  });

  it("set-final-turn committed between getMeta and BEGIN → honors new final turn, stops there", () => {
    const { deps, driver, dbPath, gameId } = setup(0, 21600);
    deps.turnService.advanceTurnIfDue(1000); // turn=1
    const before = deps.repo.getMeta(gameId);
    expect(before.finalTurn).toBeNull();

    // concurrent `game set-final-turn 3` lands in the vulnerable window
    injectBeforeNextTransaction(driver, dbPath, (other) => {
      other.run("UPDATE games SET final_turn=3 WHERE id=?", gameId);
    });
    // manual advances (ignore due-ness but honor finalTurn): would reach turn=6 if unbounded
    for (let i = 0; i < 5; i++) deps.turnService.advanceTurn(1000 + i);

    const after = deps.repo.getMeta(gameId);
    expect(after.finalTurn).toBe(3); // NOT clobbered back to NULL
    expect(after.turn).toBe(3); // stopped at the new final turn
    expect(after.status).toBe("finished");
    driver.close();
  });
});
