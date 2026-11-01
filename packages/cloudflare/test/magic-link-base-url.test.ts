// Cloudflare 版は HAKONIWA_BASE_URL 未設定でも、リクエスト URL のオリジンで
// マジックリンクを作る。設定されていればその値を優先する。
// メール本文は ConsoleMailer が console.info に出す。DO の isolate で拾う。
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const LOGS = "__hakoniwaMagicLinkLogs";

function getStub(name: string) {
  const id = env.GAME.idFromName(name);
  return env.GAME.get(id);
}

async function installLogCapture(stub: ReturnType<typeof getStub>): Promise<void> {
  await runInDurableObject(stub, () => {
    const logs: string[] = [];
    (globalThis as Record<string, unknown>)[LOGS] = logs;
    const original = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
      original(...args);
    };
  });
}

async function readLogs(stub: ReturnType<typeof getStub>): Promise<string[]> {
  return await runInDurableObject(stub, () => {
    const logs = (globalThis as Record<string, unknown>)[LOGS];
    return Array.isArray(logs) ? logs.map((line) => String(line)) : [];
  });
}

async function postMagicLink(stub: ReturnType<typeof getStub>, url: string): Promise<Response> {
  return await stub.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=magic%40example.com",
  });
}

function magicLinkUrl(logs: string[]): string | undefined {
  const line = logs.find((entry) => entry.includes("magic-link/verify"));
  return line?.match(/https?:\/\/\S+/)?.[0];
}

describe("Cloudflare 版のマジックリンク baseURL", () => {
  it("HAKONIWA_BASE_URL 未設定ならリクエストのオリジンでリンクを作る", async () => {
    const stub = getStub("magic-link-request-origin");
    await installLogCapture(stub);
    const res = await postMagicLink(stub, "https://hako.example.workers.dev/auth/magic-link");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("メールを送りました");
    expect(magicLinkUrl(await readLogs(stub))).toMatch(
      /^https:\/\/hako\.example\.workers\.dev\/api\/auth\/magic-link\/verify\?/,
    );
  });

  it("HAKONIWA_BASE_URL が設定されていれば、リクエストのオリジンよりその値を使う", async () => {
    const previous = env.HAKONIWA_BASE_URL;
    env.HAKONIWA_BASE_URL = "https://configured.example";
    try {
      const stub = getStub("magic-link-configured-base-url");
      await installLogCapture(stub);
      const res = await postMagicLink(stub, "https://hako.example.workers.dev/auth/magic-link");
      expect(res.status).toBe(200);
      expect(magicLinkUrl(await readLogs(stub))).toMatch(
        /^https:\/\/configured\.example\/api\/auth\/magic-link\/verify\?/,
      );
    } finally {
      env.HAKONIWA_BASE_URL = previous ?? "";
    }
  });
});
