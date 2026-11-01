// HAKONIWA_BASE_URL を使うか、ループバックの既定にするか、起動前に止めるか。
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideNodeBaseUrl,
  effectiveViteListenHost,
  isLoopbackListenHost,
  loopbackBaseUrl,
} from "../src/base-url-required.ts";
import { loadNodeConfig } from "../src/config.ts";
import { startServer } from "../src/serve.ts";

const AUTH_SECRET = "b".repeat(32);

describe("decideNodeBaseUrl", () => {
  it("設定されていれば、待ち受け先に関係なくその URL を使う", () => {
    expect(
      decideNodeBaseUrl({
        configuredBaseUrl: "https://hako.example",
        listenHost: "0.0.0.0",
      }),
    ).toEqual({ ok: true, mode: "configured", baseUrl: "https://hako.example" });
    expect(
      decideNodeBaseUrl({ configuredBaseUrl: "https://hako.example", listenHost: "127.0.0.1" }),
    ).toEqual({ ok: true, mode: "configured", baseUrl: "https://hako.example" });
  });

  it("未設定でループバックなら http://localhost:<port> にする", () => {
    for (const listenHost of ["localhost", "127.0.0.1", "127.42.0.9", "::1", "[::1]"]) {
      const decision = decideNodeBaseUrl({ configuredBaseUrl: undefined, listenHost });
      expect(decision).toEqual({ ok: true, mode: "loopback" });
      expect(loopbackBaseUrl(5174)).toBe("http://localhost:5174");
    }
  });

  it("未設定で 0.0.0.0 ならエラーにする", () => {
    const decision = decideNodeBaseUrl({ configuredBaseUrl: undefined, listenHost: "0.0.0.0" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.message).toContain("HAKONIWA_BASE_URL");
      expect(decision.message).toContain("非ループバック");
      expect(decision.message).not.toContain("\n");
    }
  });

  it("未設定で :: ならエラーにする", () => {
    const decision = decideNodeBaseUrl({ configuredBaseUrl: undefined, listenHost: "::" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.message).toContain("非ループバック");
    }
  });

  it("ホスト未指定はループバックではない", () => {
    expect(isLoopbackListenHost(undefined)).toBe(false);
    expect(decideNodeBaseUrl({ configuredBaseUrl: undefined, listenHost: undefined }).ok).toBe(
      false,
    );
  });

  it("Vite の既定ホストは localhost、--host は 0.0.0.0", () => {
    expect(effectiveViteListenHost(undefined)).toBe("localhost");
    expect(effectiveViteListenHost(false)).toBe("localhost");
    expect(effectiveViteListenHost(true)).toBe("0.0.0.0");
    expect(isLoopbackListenHost(effectiveViteListenHost(undefined))).toBe(true);
    expect(isLoopbackListenHost(effectiveViteListenHost(true))).toBe(false);
  });
});

describe("loadNodeConfig の公開 URL", () => {
  it("ループバックなら baseUrl を空け、実際のポートは startServer が埋める", () => {
    const config = loadNodeConfig({ HAKONIWA_HOST: "127.0.0.1", PORT: "0" });
    expect(config.listenHost).toBe("127.0.0.1");
    expect(config.port).toBe(0);
    expect(config.auth.baseUrl).toBeUndefined();
  });

  it("設定済みの URL は非ループバックでもそのまま使う", () => {
    const config = loadNodeConfig({
      HAKONIWA_BASE_URL: "https://hako.example",
      HAKONIWA_HOST: "::",
    });
    expect(config.auth.baseUrl).toBe("https://hako.example");
    expect(config.listenHost).toBe("::");
  });

  it("待ち受けないコマンドは、未設定なら http://localhost:<PORT> にする", () => {
    const config = loadNodeConfig({ HAKONIWA_HOST: "0.0.0.0", PORT: "4321" }, { listen: false });
    expect(config.auth.baseUrl).toBe("http://localhost:4321");
  });
});

describe("startServer のループバック既定 URL", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未設定なら束縛したポートの http://localhost を使い、Host ヘッダは使わない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hakoniwa-listen-"));
    dirs.push(dir);
    const infos: string[] = [];
    const infoSpy = vi.spyOn(console, "info").mockImplementation((msg?: unknown) => {
      infos.push(String(msg));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const config = loadNodeConfig({
      HAKONIWA_HOST: "127.0.0.1",
      PORT: "0",
      HAKONIWA_AUTH_SECRET: AUTH_SECRET,
      HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
      HAKONIWA_BACKUP_DIR: join(dir, "backups"),
      HAKONIWA_TURN_CHECK_INTERVAL_SEC: "0",
    });
    const server = startServer(config);
    try {
      if (!server.listening) {
        await once(server, "listening");
      }
      await new Promise((resolve) => setImmediate(resolve));
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      expect(port).toBeGreaterThan(0);

      const body = new URLSearchParams({ email: "magic@example.com" }).toString();
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/auth/magic-link",
            method: "POST",
            headers: {
              host: "evil.example",
              origin: `http://localhost:${port}`,
              "content-type": "application/x-www-form-urlencoded",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end(body);
      });
      expect(status).toBe(200);
      const mail = infos.find((line) => line.includes("magic-link"));
      expect(mail).toMatch(new RegExp(`http://localhost:${port}/api/auth/magic-link/verify\\?`));
      expect(mail).not.toContain("evil.example");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      infoSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
