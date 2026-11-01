// Node 版は HAKONIWA_BASE_URL を必須にする。Host ヘッダからリクエスト URL が決まるため、
// 未設定のままリクエストの origin をマジックリンクに使うと、リンク先を差し替えられる。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeps,
  FakeBackupStore,
  FakeLogger,
  FakeMailer,
  loadConfigFromEnv,
  migrate,
} from "@hakoniwajs/core";
import { hakoniwaDevServerGuardPlugin } from "../dev-server-guard.ts";
import { runCli } from "../src/cli.ts";
import { loadNodeConfig } from "../src/config.ts";
import { NodeSqliteDriver } from "../src/driver.ts";
import { startServer } from "../src/serve.ts";

vi.mock("../src/serve.ts", () => ({
  startServer: vi.fn(),
}));

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

  it("未設定のまま db status を実行すると終了コード 1 で止まる", async () => {
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

  it("server.ts は未設定なら同じメッセージだけを出して終了コード 1 で止まる", async () => {
    vi.stubEnv("HAKONIWA_BASE_URL", "");
    const errors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? ""}`);
    }) as typeof process.exit);
    let expected = "";
    try {
      loadNodeConfig({ HAKONIWA_BASE_URL: "" });
    } catch (err) {
      expected = err instanceof Error ? err.message : String(err);
    }

    let importError: unknown;
    try {
      await import("../src/server.ts");
    } catch (err) {
      importError = err;
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }

    expect(importError).toEqual(new Error("exit:1"));
    expect(errors).toEqual([[expected]]);
    expect(expected).toContain("HAKONIWA_BASE_URL");
    expect(expected).not.toContain("\n");
    expect(startServer).not.toHaveBeenCalled();
  });

  it("開発サーバーは listen 前に同じメッセージで終了コード 1 になる", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("HAKONIWA_BASE_URL", "");
    const errors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? ""}`);
    }) as typeof process.exit);
    let expected = "";
    try {
      loadNodeConfig({ HAKONIWA_BASE_URL: "" });
    } catch (err) {
      expected = err instanceof Error ? err.message : String(err);
    }

    const plugin = hakoniwaDevServerGuardPlugin();
    let caught: unknown;
    try {
      plugin.configureServer({ config: { mode: "development" } });
    } catch (err) {
      caught = err;
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }

    expect(caught).toEqual(new Error("exit:1"));
    expect(errors).toEqual([[expected]]);
    expect(expected).toContain("HAKONIWA_BASE_URL");
    expect(expected).not.toContain("\n");
  });

  it("開発サーバーの検査はテストと build では動かない", () => {
    vi.stubEnv("VITEST", "true");
    const plugin = hakoniwaDevServerGuardPlugin();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? ""}`);
    }) as typeof process.exit);
    try {
      expect(plugin.apply({}, { command: "build", mode: "production" })).toBe(false);
      expect(plugin.apply({}, { command: "serve", mode: "test" })).toBe(false);
      expect(plugin.apply({}, { command: "serve", mode: "development" })).toBe(false);
      plugin.configureServer({ config: { mode: "development" } });
      plugin.configureServer({ config: { mode: "test" } });
      expect(exitSpy).not.toHaveBeenCalled();

      vi.stubEnv("VITEST", "");
      expect(plugin.apply({}, { command: "serve", mode: "development" })).toBe(true);
      expect(plugin.apply({}, { command: "serve", mode: "test" })).toBe(false);
      expect(plugin.apply({}, { command: "build", mode: "production" })).toBe(false);

      vi.stubEnv("HAKONIWA_BASE_URL", "http://localhost:5173");
      plugin.configureServer({ config: { mode: "development" } });
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("pnpm dev は未設定なら listen する前に同じメッセージで終了する", async () => {
    let expected = "";
    try {
      loadNodeConfig({});
    } catch (err) {
      expected = err instanceof Error ? err.message : String(err);
    }
    const env = { ...process.env };
    delete env.HAKONIWA_BASE_URL;
    delete env.VITEST;
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn("pnpm", ["dev"], {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`timed out\nstdout:${stdout}\nstderr:${stderr}`));
        }, 12_000);
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(expected);
    expect(result.stdout).not.toContain("Local:");
    expect(expected).not.toContain("\n");
  }, 20_000);

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
