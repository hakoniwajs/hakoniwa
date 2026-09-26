// HAKONIWA_AUTH_SECRET を任意にした件の結合テスト。実 SQLite (migrate 済み) の settings 表に
// 自動生成した secret が保存され、同じ DB で組み立て直しても同じ値が使われることを確認する。
import {
  AUTH_SECRET_SETTINGS_KEY,
  FakeBackupStore,
  FakeLogger,
  SqliteSettingsRepository,
  buildDeps,
  loadConfigFromEnv,
  migrate,
} from "@hakoniwajs/core";
import { describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../src/driver.ts";

function build(driver: NodeSqliteDriver, env: Record<string, string | undefined>) {
  return buildDeps({
    driver,
    backupStore: new FakeBackupStore(),
    clock: { now: () => 1_000_000 },
    config: loadConfigFromEnv(env),
    logger: new FakeLogger(),
  });
}

describe("auth secret の自動生成", () => {
  it("HAKONIWA_AUTH_SECRET が無ければ settings 表に保存し、組み立て直しても同じ値を使う", () => {
    const driver = new NodeSqliteDriver(":memory:");
    migrate(driver);
    const first = build(driver, {});
    expect(first.authSecret.length).toBeGreaterThanOrEqual(32);
    expect(new SqliteSettingsRepository(driver).get(AUTH_SECRET_SETTINGS_KEY)).toBe(
      first.authSecret,
    );
    const second = build(driver, {});
    expect(second.authSecret).toBe(first.authSecret);
  });

  it("HAKONIWA_AUTH_SECRET があればそれを使う", () => {
    const driver = new NodeSqliteDriver(":memory:");
    migrate(driver);
    const secret = "b".repeat(32);
    const deps = build(driver, { HAKONIWA_AUTH_SECRET: secret });
    expect(deps.authSecret).toBe(secret);
    expect(new SqliteSettingsRepository(driver).get(AUTH_SECRET_SETTINGS_KEY)).toBeUndefined();
  });

  it("管理者が未設定なら起動時にセットアップの案内をログに出す", () => {
    const driver = new NodeSqliteDriver(":memory:");
    migrate(driver);
    const logger = new FakeLogger();
    buildDeps({
      driver,
      backupStore: new FakeBackupStore(),
      clock: { now: () => 1_000_000 },
      config: loadConfigFromEnv({}),
      logger,
    });
    expect(logger.warns.some((msg) => msg.includes("/admin/setup"))).toBe(true);
  });
});
