import { describe, expect, it } from "vitest";
import { defaultConfig } from "../core/config.ts";
import { loadConfigFromEnv } from "./config-from-env.ts";

const AUTH_SECRET = "a".repeat(32);

describe("loadConfigFromEnv", () => {
  it("環境変数が無くても HAKONIWA_AUTH_SECRET さえあれば defaultConfig 相当になる", () => {
    const config = loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET });
    expect(config.game.debug).toBe(defaultConfig.debug);
    expect(config.game.useLbbs).toBe(defaultConfig.useLbbs);
    expect(config.game.unitTimeSec).toBe(defaultConfig.unitTimeSec);
    expect(config.game.maxCatchUpTurns).toBe(defaultConfig.maxCatchUpTurns);
    expect(config.game.site).toEqual(defaultConfig.site);
    expect(config.adminEnabled).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.ngWords).toEqual([]);
    expect(config.mail).toEqual({ mailFrom: "hakoniwa@example.com" });
    expect(config.auth).toEqual({
      secret: AUTH_SECRET,
      devLogin: false,
      adminEmails: [],
    });
    expect(config.auth.baseUrl).toBeUndefined();
  });

  it("環境変数が 1 つも無くても組み立てられる (HAKONIWA_AUTH_SECRET は任意)", () => {
    const config = loadConfigFromEnv({});
    expect(config.auth).toEqual({ devLogin: false, adminEmails: [] });
    expect(config.auth.secret).toBeUndefined();
  });

  it("HAKONIWA_AUTH_SECRET が空文字列なら未設定扱い", () => {
    const config = loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: "" });
    expect(config.auth.secret).toBeUndefined();
  });

  it("真偽値・数値・文字列の環境変数を反映する", () => {
    const config = loadConfigFromEnv({
      HAKONIWA_AUTH_SECRET: AUTH_SECRET,
      HAKONIWA_DEBUG: "true",
      HAKONIWA_ADMIN_ENABLED: "false",
      HAKONIWA_USE_LBBS: "true",
      HAKONIWA_UNIT_TIME_SEC: "3600",
      HAKONIWA_MAX_CATCH_UP_TURNS: "5",
      HAKONIWA_SITE_TITLE: "テストサイト",
      HAKONIWA_ADMIN_NAME: "管理者太郎",
      HAKONIWA_EMAIL: "a@example.com",
      HAKONIWA_BBS_URL: "http://example.com/bbs",
      HAKONIWA_TOPPAGE_URL: "http://example.com/",
      HAKONIWA_BASE_URL: "https://hakoniwa.example.com",
      HAKONIWA_DEV_LOGIN: "true",
      HAKONIWA_ADMIN_EMAILS: "a@example.com, b@example.com",
      HAKONIWA_NG_WORDS: "だめなことば, もうひとつ",
    });
    expect(config.game.debug).toBe(true);
    expect(config.debug).toBe(true);
    expect(config.adminEnabled).toBe(false);
    expect(config.game.useLbbs).toBe(true);
    expect(config.game.unitTimeSec).toBe(3600);
    expect(config.game.maxCatchUpTurns).toBe(5);
    expect(config.game.site).toEqual({
      title: "テストサイト",
      adminName: "管理者太郎",
      email: "a@example.com",
      bbsUrl: "http://example.com/bbs",
      topPageUrl: "http://example.com/",
    });
    expect(config.auth.baseUrl).toBe("https://hakoniwa.example.com");
    expect(config.auth.devLogin).toBe(true);
    expect(config.auth.adminEmails).toEqual(["a@example.com", "b@example.com"]);
    expect(config.ngWords).toEqual(["だめなことば", "もうひとつ"]);
  });

  it("サイト情報の環境変数が空文字列なら defaultConfig にフォールバックする (Cloudflare vars 対策)", () => {
    const config = loadConfigFromEnv({
      HAKONIWA_AUTH_SECRET: AUTH_SECRET,
      HAKONIWA_SITE_TITLE: "",
      HAKONIWA_ADMIN_NAME: "",
      HAKONIWA_EMAIL: "",
      HAKONIWA_BBS_URL: "",
      HAKONIWA_TOPPAGE_URL: "",
    });
    expect(config.game.site).toEqual(defaultConfig.site);
  });

  it("X/Discord のクライアント ID・シークレットが両方揃えば有効になる", () => {
    const config = loadConfigFromEnv({
      HAKONIWA_AUTH_SECRET: AUTH_SECRET,
      HAKONIWA_X_CLIENT_ID: "x-id",
      HAKONIWA_X_CLIENT_SECRET: "x-secret",
      HAKONIWA_DISCORD_CLIENT_ID: "discord-id",
      HAKONIWA_DISCORD_CLIENT_SECRET: "discord-secret",
    });
    expect(config.auth.x).toEqual({ clientId: "x-id", clientSecret: "x-secret" });
    expect(config.auth.discord).toEqual({ clientId: "discord-id", clientSecret: "discord-secret" });
  });

  it("HAKONIWA_RESEND_API_KEY / HAKONIWA_MAIL_FROM を反映する", () => {
    const config = loadConfigFromEnv({
      HAKONIWA_AUTH_SECRET: AUTH_SECRET,
      HAKONIWA_RESEND_API_KEY: "re_test",
      HAKONIWA_MAIL_FROM: "info@example.com",
    });
    expect(config.mail).toEqual({ resendApiKey: "re_test", mailFrom: "info@example.com" });
  });

  it("クライアント ID とシークレットの片方だけでは Error", () => {
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_X_CLIENT_ID: "x-id" }),
    ).toThrow(/HAKONIWA_X/);
  });

  it("不正な真偽値は Error を投げる", () => {
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_DEBUG: "yes" }),
    ).toThrow(/HAKONIWA_DEBUG/);
  });

  it("不正な数値は Error を投げる", () => {
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_UNIT_TIME_SEC: "abc" }),
    ).toThrow(/HAKONIWA_UNIT_TIME_SEC/);
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_UNIT_TIME_SEC: "1.5" }),
    ).toThrow(/HAKONIWA_UNIT_TIME_SEC/);
  });

  it("0 以下の unitTimeSec / maxCatchUpTurns は Error を投げる", () => {
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_UNIT_TIME_SEC: "0" }),
    ).toThrow();
    expect(() =>
      loadConfigFromEnv({ HAKONIWA_AUTH_SECRET: AUTH_SECRET, HAKONIWA_MAX_CATCH_UP_TURNS: "-1" }),
    ).toThrow();
  });
});
