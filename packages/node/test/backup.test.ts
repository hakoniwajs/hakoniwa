import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, SqliteGameRepository, defaultConfig } from "@hakoniwajs/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { FileBackupStore } from "../src/backup.ts";
import { NodeSqliteDriver } from "../src/driver.ts";

describe("FileBackupStore", () => {
  let dir: string;
  let dbPath: string;
  let backupDir: string;
  let driver: NodeSqliteDriver;
  let repo: SqliteGameRepository;
  let store: FileBackupStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hakoniwa-backup-test-"));
    dbPath = join(dir, "hakoniwa.sqlite");
    backupDir = join(dir, "backups");
    driver = new NodeSqliteDriver(dbPath);
    migrate(driver);
    repo = new SqliteGameRepository(driver, {
      islandSize: defaultConfig.islandSize,
      commandMax: defaultConfig.commandMax,
    });
    store = new FileBackupStore(dbPath, backupDir, driver);
  });

  afterEach(() => {
    try {
      driver.close();
    } catch {
      // 既に close 済みなら無視。
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("create → list → データ変更 → restore で元に戻る", async () => {
    const gameId = repo.createGame(
      { name: "第 1 回", startAt: 0, finalTurn: null, unitTimeSec: defaultConfig.unitTimeSec },
      0,
    );

    await store.create("turn-1", 1);
    expect(existsSync(join(backupDir, "turn-1.sqlite"))).toBe(true);

    const list1 = await store.list();
    expect(list1).toEqual([{ label: "turn-1", turn: 1, createdAt: expect.any(Number) }]);

    // バックアップ後にデータを変更する。
    repo.saveMeta({ ...repo.getMeta(gameId), turn: 5, lastTime: 999 });
    expect(repo.getMeta(gameId).turn).toBe(5);

    await store.restore("turn-1");

    // restore は driver.reopen() 済みなので、同じ driver 経由でそのまま読める。
    // tmp/16-season.md「開始前の状態 = ターン 0」節: バックアップ取得時点は turn=0 (開始前)。
    expect(repo.getMeta(gameId).turn).toBe(0);
    expect(existsSync(`${dbPath}.before-restore`)).toBe(true);
  });

  it("delete でバックアップを削除できる", async () => {
    repo.createGame(
      { name: "第 1 回", startAt: 0, finalTurn: null, unitTimeSec: defaultConfig.unitTimeSec },
      0,
    );
    await store.create("to-delete", 1);
    expect((await store.list()).map((b) => b.label)).toEqual(["to-delete"]);

    await store.delete("to-delete");
    expect(await store.list()).toEqual([]);
    expect(existsSync(join(backupDir, "to-delete.sqlite"))).toBe(false);
  });

  it("rotate は createdAt 降順で keep 件だけ残す", async () => {
    repo.createGame(
      { name: "第 1 回", startAt: 0, finalTurn: null, unitTimeSec: defaultConfig.unitTimeSec },
      0,
    );
    await store.create("turn-1", 1);
    await store.create("turn-2", 2);
    await store.create("turn-3", 3);
    // createdAt はテスト内で明示的に上書きし、実時間待機に頼らず順序を確定させる。
    writeFileSync(join(backupDir, "turn-1.json"), JSON.stringify({ turn: 1, createdAt: 100 }));
    writeFileSync(join(backupDir, "turn-2.json"), JSON.stringify({ turn: 2, createdAt: 200 }));
    writeFileSync(join(backupDir, "turn-3.json"), JSON.stringify({ turn: 3, createdAt: 300 }));

    await store.rotate(2);

    const remaining = (await store.list()).map((b) => b.label).sort();
    expect(remaining).toEqual(["turn-2", "turn-3"]);
  });

  it("不正なラベルは create/restore/delete いずれも Error を投げる", async () => {
    repo.createGame(
      { name: "第 1 回", startAt: 0, finalTurn: null, unitTimeSec: defaultConfig.unitTimeSec },
      0,
    );
    await expect(store.create("../evil", 1)).rejects.toThrow();
    await expect(store.restore("../evil")).rejects.toThrow();
    await expect(store.delete("../evil")).rejects.toThrow();
  });

  it("restore は存在しないラベルなら Error を投げる", async () => {
    await expect(store.restore("no-such-label")).rejects.toThrow();
  });
});
