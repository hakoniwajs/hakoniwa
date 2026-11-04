// tmp/14-users-auth.md 「カスタム DB アダプタ」節のテスト。
// :memory: の実 SQLite (node:sqlite) + 実 better-auth インスタンスを使い、
// devLogin / magicLink の往復、ログイン方法の設定 (settings) による拒否、
// アカウント連携まわり (listUserAccounts, changeEmail) を検証する。
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AuthMethodPolicy,
  FakeBackupStore,
  FakeMailer,
  FakeSettingsRepository,
  betterAuthSqliteAdapter,
  buildDeps,
  createAuth,
  loadConfigFromEnv,
  migrate,
} from "@hakoniwajs/core";
import type { AppConfig } from "@hakoniwajs/core";
import { NodeSqliteDriver } from "../src/driver.ts";

const AUTH_SECRET = "a".repeat(32);

function setup(options: { devLogin?: boolean } = {}) {
  const driver = new NodeSqliteDriver(":memory:");
  migrate(driver);
  const mailer = new FakeMailer();
  const settings = new FakeSettingsRepository();
  const authMethods = new AuthMethodPolicy({
    configured: { x: false, discord: false, email: true },
    settings,
  });
  const config: AppConfig = loadConfigFromEnv({
    HAKONIWA_AUTH_SECRET: AUTH_SECRET,
    HAKONIWA_BASE_URL: "http://localhost:5173",
    HAKONIWA_DEV_LOGIN: options.devLogin === false ? "false" : "true",
  });
  const auth = createAuth({ driver, config, secret: AUTH_SECRET, mailer, authMethods });
  return { driver, mailer, settings, authMethods, auth };
}

/** `Headers.getSetCookie()` の各 Set-Cookie から `name=value` だけを取り出し、Cookie ヘッダ用に結合する。 */
function toCookieHeader(setCookies: string[]): string {
  return setCookies.map((sc) => sc.split(";")[0]).join("; ");
}

describe("devLogin → getSession → signOut", () => {
  it("往復でき、user 行の内容 (email 小文字化、emailVerified) が検証できる", async () => {
    const { auth } = setup();

    const loginResult = await auth.api.devLogin({
      body: { email: "Foo@Example.com" },
      returnHeaders: true,
    });
    const setCookies = loginResult.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
    const cookie = toCookieHeader(setCookies);

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("foo@example.com");
    expect(session?.user.emailVerified).toBe(true);
    expect(session?.user.name).toBe("foo");

    const signOutResult = await auth.api.signOut({
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    expect(signOutResult.response.success).toBe(true);

    const afterSignOut = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(afterSignOut).toBeNull();
  });

  it("devLogin で作られたユーザーは account 行を持たない (listUserAccounts が空)", async () => {
    const { auth } = setup();
    const { headers } = await auth.api.devLogin({
      body: { email: "bar@example.com" },
      returnHeaders: true,
    });
    const cookie = toCookieHeader(headers.getSetCookie());

    const accounts = await auth.api.listUserAccounts({ headers: new Headers({ cookie }) });
    expect(accounts).toEqual([]);
  });

  it("HAKONIWA_DEV_LOGIN=false ならエンドポイント自体が存在しない", async () => {
    const { auth } = setup({ devLogin: false });
    const req = new Request("http://localhost:5173/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    const res = await auth.handler(req);
    expect(res.status).toBe(404);
  });
});

describe("magicLink", () => {
  it("送られたリンクの token で verify するとセッションが得られる", async () => {
    const { auth, mailer } = setup();

    await auth.api.signInMagicLink({
      body: { email: "magic@example.com" },
      headers: new Headers(),
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("magic@example.com");
    const url = mailer.lastUrl();
    expect(url).toBeDefined();
    const token = new URL(url!).searchParams.get("token");
    expect(token).toBeTruthy();

    const verifyResult = await auth.api.magicLinkVerify({
      query: { token: token! },
      headers: new Headers(),
      returnHeaders: true,
    });
    expect(verifyResult.response.user?.email).toBe("magic@example.com");
    const cookie = toCookieHeader(verifyResult.headers.getSetCookie());

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("magic@example.com");
  });

  it("settings で email ログインを無効にすると /sign-in/magic-link が拒否される", async () => {
    const { auth, authMethods } = setup();
    authMethods.setEnabled({ x: false, discord: false, email: false });

    await expect(
      auth.api.signInMagicLink({ body: { email: "magic2@example.com" }, headers: new Headers() }),
    ).rejects.toThrow();
  });
});

describe("changeEmail", () => {
  it("確認リンクが Fake Mailer に送られる", async () => {
    const { auth, mailer } = setup();
    const { headers } = await auth.api.devLogin({
      body: { email: "old@example.com" },
      returnHeaders: true,
    });
    const cookie = toCookieHeader(headers.getSetCookie());

    await auth.api.changeEmail({
      body: { newEmail: "new@example.com" },
      headers: new Headers({ cookie }),
    });

    const changeMail = mailer.sent.find((m) => m.to === "new@example.com");
    expect(changeMail).toBeDefined();
    expect(changeMail?.text).toContain("http");
  });

  // better-auth 1.7.16 以降、メール変更の確認リンクはセッションを作らない。
  // ログイン中なら /account に戻り、未ログインなら /account が /login へ誘導する。
  describe("確認リンクを開いたあとの画面 (1.7.16)", () => {
    function setupApp() {
      const driver = new NodeSqliteDriver(":memory:");
      migrate(driver);
      const mailer = new FakeMailer();
      const config: AppConfig = loadConfigFromEnv({
        HAKONIWA_AUTH_SECRET: AUTH_SECRET,
        HAKONIWA_BASE_URL: "http://localhost:5173",
        HAKONIWA_DEV_LOGIN: "true",
        HAKONIWA_ADMIN_EMAILS: "admin@example.com",
      });
      const deps = buildDeps({
        driver,
        backupStore: new FakeBackupStore(),
        clock: { now: () => 1_000_000 },
        config,
        mailer,
      });
      return { ...deps, driver, mailer };
    }

    function absorbCookies(response: Response, jar: Map<string, string>): void {
      for (const setCookie of response.headers.getSetCookie()) {
        const [pair, ...attrs] = setCookie.split(";").map((part) => part.trim());
        const eq = pair?.indexOf("=") ?? -1;
        if (pair === undefined || eq < 1) {
          continue;
        }
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const cleared = attrs.some((attr) => attr.toLowerCase() === "max-age=0");
        if (cleared || value === "") {
          jar.delete(name);
        } else {
          jar.set(name, value);
        }
      }
    }

    function cookieHeader(jar: Map<string, string>): string {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    async function devLogin(app: ReturnType<typeof setupApp>["app"], email: string) {
      const res = await app.request("http://localhost:5173/auth/dev", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }),
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const jar = new Map<string, string>();
      absorbCookies(res, jar);
      return jar;
    }

    async function requestEmailChange(
      ctx: ReturnType<typeof setupApp>,
      jar: Map<string, string>,
      email: string,
    ): Promise<string> {
      const account = await ctx.app.request("http://localhost:5173/account", {
        headers: { cookie: cookieHeader(jar) },
      });
      expect(account.status).toBe(200);
      const html = await account.text();
      const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
      if (csrf === undefined) {
        throw new Error("csrf token missing");
      }
      const posted = await ctx.app.request("http://localhost:5173/account/email", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookieHeader(jar),
        },
        body: new URLSearchParams({ email, _csrf: csrf }),
      });
      expect(posted.status).toBe(200);
      expect(await posted.text()).toContain("確認メールを送りました");
      const changeMail = ctx.mailer.sent.find((mail) => mail.to === email);
      const url = changeMail?.text;
      if (url === undefined || !url.startsWith("http")) {
        throw new Error(`verification url missing: ${url}`);
      }
      return url;
    }

    async function follow(
      app: ReturnType<typeof setupApp>["app"],
      first: Response,
      jar: Map<string, string>,
    ): Promise<{ response: Response; url: URL }> {
      let response = first;
      let url = new URL("http://localhost:5173/");
      for (let i = 0; i < 5 && response.status >= 300 && response.status < 400; i++) {
        absorbCookies(response, jar);
        const location = response.headers.get("location");
        if (location === null) {
          break;
        }
        url = new URL(location, "http://localhost:5173");
        response = await app.request(url, {
          redirect: "manual",
          headers: jar.size > 0 ? { cookie: cookieHeader(jar) } : {},
        });
      }
      return { response, url };
    }

    it("未ログインで開くとサインインせず、ログイン画面に着く", async () => {
      const ctx = setupApp();
      try {
        const jar = await devLogin(ctx.app, "old@example.com");
        const url = await requestEmailChange(ctx, jar, "new@example.com");

        const opened = await ctx.app.request(url, { redirect: "manual" });
        expect(opened.headers.getSetCookie().join(";")).not.toContain("hako.session_token=");
        const landed = await follow(ctx.app, opened, new Map());
        expect(landed.response.status).toBe(200);
        expect(landed.url.pathname).toBe("/login");
        expect(await landed.response.text()).toContain("ログイン");

        const user = ctx.driver.get<{ email: string; emailVerified: number }>(
          `SELECT email, emailVerified FROM "user" WHERE email = ?`,
          "new@example.com",
        );
        expect(user).toEqual({ email: "new@example.com", emailVerified: 1 });
      } finally {
        ctx.driver.close();
      }
    });

    it("ログイン中に開くとアカウント設定に戻り、変更後のメールを表示する", async () => {
      const ctx = setupApp();
      try {
        const jar = await devLogin(ctx.app, "old@example.com");
        const url = await requestEmailChange(ctx, jar, "new@example.com");

        const opened = await ctx.app.request(url, {
          redirect: "manual",
          headers: { cookie: cookieHeader(jar) },
        });
        const landed = await follow(ctx.app, opened, jar);
        expect(landed.response.status).toBe(200);
        expect(landed.url.pathname).toBe("/account");
        expect(await landed.response.text()).toContain("現在のメールアドレス: new@example.com");

        const session = await ctx.auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader(jar) }),
        });
        expect(session?.user.email).toBe("new@example.com");
      } finally {
        ctx.driver.close();
      }
    });
  });
});

describe("betterAuthSqliteAdapter (単体)", () => {
  let driver: NodeSqliteDriver;

  beforeEach(() => {
    driver = new NodeSqliteDriver(":memory:");
    migrate(driver);
  });

  it("create → findOne → update → count → delete の往復ができる", async () => {
    const factory = betterAuthSqliteAdapter({ driver });
    const adapter = factory({});

    const user = await adapter.create<Record<string, unknown>>({
      model: "user",
      data: { email: "a@example.com", name: "Alice", emailVerified: false },
    });
    expect(user.email).toBe("a@example.com");
    expect(user.emailVerified).toBe(false);
    expect(typeof user.id).toBe("string");
    const id = user.id as string;

    const found = await adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "id", value: id }],
    });
    expect(found?.email).toBe("a@example.com");

    const updated = await adapter.update<Record<string, unknown>>({
      model: "user",
      where: [{ field: "id", value: id }],
      update: { name: "Alice Updated" },
    });
    expect(updated?.name).toBe("Alice Updated");

    const count = await adapter.count({ model: "user", where: [{ field: "id", value: id }] });
    expect(count).toBe(1);

    await adapter.delete({ model: "user", where: [{ field: "id", value: id }] });
    const afterDelete = await adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "id", value: id }],
    });
    expect(afterDelete).toBeNull();
    expect(await adapter.count({ model: "user" })).toBe(0);
  });
});
