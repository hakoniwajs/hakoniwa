// Node 版は、非ループバック待ち受けで HAKONIWA_BASE_URL が無いと listen 前に止まる。
// Host ヘッダからリクエスト URL が決まるため、未設定のままリクエストの origin を
// マジックリンクに使うと、リンク先を差し替えられる。ループバックだけ http://localhost:<port>。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
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
  it("未設定かつ待ち受け先が非ループバックなら loadNodeConfig が起動前にエラーにする", () => {
    expect(() => loadNodeConfig({})).toThrow(/非ループバック/);
    expect(() => loadNodeConfig({ HAKONIWA_BASE_URL: "" })).toThrow(/HAKONIWA_BASE_URL/);
    expect(() => loadNodeConfig({ HAKONIWA_HOST: "0.0.0.0" })).toThrow(/HAKONIWA_BASE_URL/);
    expect(() => loadNodeConfig({ HAKONIWA_HOST: "::" })).toThrow(/HAKONIWA_BASE_URL/);
  });

  it("HTTP を配信しないコマンドは、未設定ならループバックの既定 URL で動く", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hakoniwa-cli-base-url-"));
    try {
      const lines: string[] = [];
      const code = await runCli(
        ["db", "status"],
        {
          HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
          HAKONIWA_BACKUP_DIR: join(dir, "backups"),
          HAKONIWA_AUTH_SECRET: AUTH_SECRET,
          PORT: "4321",
        },
        {
          stdout: (line) => {
            lines.push(line);
          },
          stderr: () => {},
        },
      );
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("未初期化");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未設定のエラーメッセージは、非ループバックでは公開 URL が必要だと一行で言う", async () => {
    const errLines: string[] = [];
    const code = await runCli(
      ["serve"],
      { HAKONIWA_HOST: "0.0.0.0" },
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
    expect(text).toContain("非ループバック");
    expect(text).not.toContain("\n");
  });

  it("server.ts は未設定なら同じメッセージだけを出して終了コード 1 で止まる", async () => {
    vi.stubEnv("HAKONIWA_BASE_URL", "");
    vi.stubEnv("HAKONIWA_HOST", "");
    const errors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? ""}`);
    }) as typeof process.exit);
    let expected = "";
    try {
      loadNodeConfig({ HAKONIWA_BASE_URL: "", HAKONIWA_HOST: "" });
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

  it("開発サーバーは非ループバックなら listen 前に同じメッセージで終了コード 1 になる", () => {
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
      loadNodeConfig({ HAKONIWA_BASE_URL: "", HAKONIWA_HOST: "0.0.0.0" });
    } catch (err) {
      expected = err instanceof Error ? err.message : String(err);
    }

    const plugin = hakoniwaDevServerGuardPlugin();
    try {
      for (const host of ["0.0.0.0", "::", true] as const) {
        expect(() => {
          plugin.configureServer({ config: { mode: "development", server: { host } } });
        }).toThrow(new Error("exit:1"));
      }
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }

    expect(errors).toEqual([[expected], [expected], [expected]]);
    expect(expected).toContain("HAKONIWA_BASE_URL");
    expect(expected).toContain("非ループバック");
    expect(expected).not.toContain("\n");
  });

  it("開発サーバーはループバックなら実際に束縛したポートを公開 URL にする", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("HAKONIWA_BASE_URL", "");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? ""}`);
    }) as typeof process.exit);
    const plugin = hakoniwaDevServerGuardPlugin();
    let onListening: (() => void) | undefined;
    try {
      plugin.configureServer({
        config: { mode: "development", server: { host: undefined, port: 5173 } },
        httpServer: {
          listening: false,
          address: () => ({ port: 5174 }),
          once: (event, listener) => {
            if (event === "listening") onListening = listener;
          },
        },
      });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.env.HAKONIWA_BASE_URL).toBe("");
      onListening?.();
      expect(process.env.HAKONIWA_BASE_URL).toBe("http://localhost:5174");

      vi.stubEnv("HAKONIWA_BASE_URL", "https://keep.example");
      onListening?.();
      expect(process.env.HAKONIWA_BASE_URL).toBe("https://keep.example");
    } finally {
      exitSpy.mockRestore();
      vi.unstubAllEnvs();
    }
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
