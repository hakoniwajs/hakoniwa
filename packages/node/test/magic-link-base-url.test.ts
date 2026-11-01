// Node 版は HAKONIWA_BASE_URL を必須にする。Host ヘッダからリクエスト URL が決まるため、
// 未設定のままリクエストの origin をマジックリンクに使うと、リンク先を差し替えられる。
import { describe, expect, it } from "vitest";
import {
  buildDeps,
  FakeBackupStore,
  FakeLogger,
  FakeMailer,
  loadConfigFromEnv,
  migrate,
} from "@hakoniwajs/core";
import { runCli } from "../src/cli.ts";
import { loadNodeConfig } from "../src/config.ts";
import { NodeSqliteDriver } from "../src/driver.ts";

const AUTH_SECRET = "a".repeat(32);

function setupApp(baseUrl: string) {
  const driver = new NodeSqliteDriver(":memory:");
  migrate(driver);
  const mailer = new FakeMailer();
  const config = loadConfigFromEnv({
    HAKONIWA_AUTH_SECRET: AUTH_SECRET,
    HAKONIWA_BASE_URL: baseUrl,
  });
  const deps = buildDeps({
    driver,
    backupStore: new FakeBackupStore(),
    clock: { now: () => 1_000_000 },
    config,
    mailer,
    logger: new FakeLogger(),
  });
  return { app: deps.app, mailer };
}

describe("Node 版の HAKONIWA_BASE_URL", () => {
  it("未設定なら loadNodeConfig が起動前にエラーにする", () => {
    expect(() => loadNodeConfig({})).toThrow(/HAKONIWA_BASE_URL/);
    expect(() => loadNodeConfig({ HAKONIWA_BASE_URL: "" })).toThrow(/HAKONIWA_BASE_URL/);
  });

  it("未設定のまま hakoniwa を起動すると、設定例を含むエラーで止まる", async () => {
    const code = await runCli(
      ["db", "status"],
      {},
      {
        stdout: () => {},
        stderr: () => {},
      },
    );
    expect(code).toBe(1);
  });

  it("未設定のエラーメッセージに、何を設定すればよいか書いてある", async () => {
    const errLines: string[] = [];
    const code = await runCli(
      ["serve"],
      {},
      {
        stdout: () => {},
        stderr: (line) => {
          errLines.push(line);
        },
      },
    );
    expect(code).toBe(1);
    const text = errLines.join("\n");
    expect(text).toContain("HAKONIWA_BASE_URL");
    expect(text).toContain("http://localhost:5173");
  });

  it("設定されていれば、リクエストの Host ではなくその URL でリンクを作る", async () => {
    const { app, mailer } = setupApp("http://localhost:5173");
    const res = await app.request("http://evil.example/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "evil.example" },
      body: new URLSearchParams({ email: "magic@example.com" }),
    });
    expect(res.status).toBe(200);
    expect(mailer.lastUrl()).toMatch(/^http:\/\/localhost:5173\/api\/auth\/magic-link\/verify\?/);
  });
});
