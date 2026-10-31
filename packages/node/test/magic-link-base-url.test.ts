// HAKONIWA_BASE_URL 未設定でも POST /auth/magic-link が 500 にならないこと。
// better-auth の magic-link は `new URL(ctx.context.baseURL)` する。baseURL を渡さない
// `auth.api.signInMagicLink` では空文字になり TypeError になるため、リクエストの
// オリジンを baseURL にすることをここから確認する。
import { describe, expect, it } from "vitest";
import {
  buildDeps,
  FakeBackupStore,
  FakeLogger,
  FakeMailer,
  loadConfigFromEnv,
  migrate,
} from "@hakoniwajs/core";
import { NodeSqliteDriver } from "../src/driver.ts";

const AUTH_SECRET = "a".repeat(32);

function setup(baseUrl?: string) {
  const driver = new NodeSqliteDriver(":memory:");
  migrate(driver);
  const mailer = new FakeMailer();
  const config = loadConfigFromEnv({
    HAKONIWA_AUTH_SECRET: AUTH_SECRET,
    ...(baseUrl !== undefined ? { HAKONIWA_BASE_URL: baseUrl } : {}),
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

async function postMagicLink(app: ReturnType<typeof setup>["app"], url: string): Promise<Response> {
  return await app.request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "magic@example.com" }),
  });
}

describe("POST /auth/magic-link の baseURL", () => {
  it("HAKONIWA_BASE_URL 未設定でも 500 にならず、リクエストのオリジンでリンクを作る", async () => {
    const { app, mailer } = setup();
    const res = await postMagicLink(app, "http://example.test/auth/magic-link");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("メールを送りました");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.lastUrl()).toMatch(/^http:\/\/example\.test\/api\/auth\/magic-link\/verify\?/);
  });

  it("HAKONIWA_BASE_URL が設定されていれば、リクエストのオリジンよりその値を優先する", async () => {
    const { app, mailer } = setup("http://configured.example:5173");
    const res = await postMagicLink(app, "http://example.test/auth/magic-link");
    expect(res.status).toBe(200);
    expect(mailer.lastUrl()).toMatch(
      /^http:\/\/configured\.example:5173\/api\/auth\/magic-link\/verify\?/,
    );
  });
});
