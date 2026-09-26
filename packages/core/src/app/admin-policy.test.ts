import { describe, expect, it } from "vitest";
import {
  ADMIN_EMAILS_SETTINGS_KEY,
  ADMIN_SETUP_CODE_SETTINGS_KEY,
  AdminPolicy,
} from "./admin-policy.ts";
import { AppError } from "./errors.ts";
import { FakeSettingsRepository } from "./fake-repository.ts";

function setup(envEmails: string[] = []) {
  const settings = new FakeSettingsRepository();
  const policy = new AdminPolicy({ envEmails, settings });
  return { settings, policy };
}

function expectAppError(fn: () => void, kind: AppError["kind"]) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).kind).toBe(kind);
    return;
  }
  throw new Error("expected AppError");
}

describe("AdminPolicy", () => {
  it("環境変数の管理者を大文字小文字を無視して判定する", () => {
    const { policy } = setup(["Admin@Example.com"]);
    expect(policy.isAdmin("admin@example.com")).toBe(true);
    expect(policy.isAdmin("other@example.com")).toBe(false);
    expect(policy.needsSetup()).toBe(false);
  });

  it("settings 表の管理者も管理者として扱う", () => {
    const { policy, settings } = setup();
    settings.set(ADMIN_EMAILS_SETTINGS_KEY, JSON.stringify(["stored@example.com"]));
    expect(policy.isAdmin("stored@example.com")).toBe(true);
    expect(policy.adminEmails()).toEqual(["stored@example.com"]);
    expect(policy.needsSetup()).toBe(false);
  });

  it("settings 表の値が壊れていても空扱いにする", () => {
    const { policy, settings } = setup();
    settings.set(ADMIN_EMAILS_SETTINGS_KEY, "not json");
    expect(policy.storedEmails()).toEqual([]);
    expect(policy.needsSetup()).toBe(true);
  });

  it("環境変数にも settings 表にも管理者がいなければ needsSetup", () => {
    const { policy } = setup();
    expect(policy.needsSetup()).toBe(true);
  });

  it("setupCode は生成して保存し、同じ値を返す", () => {
    const { policy, settings } = setup();
    const code = policy.setupCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    expect(settings.get(ADMIN_SETUP_CODE_SETTINGS_KEY)).toBe(code);
    expect(policy.setupCode()).toBe(code);
  });

  it("正しいセットアップコードで最初の管理者になれる (小文字・ハイフン無しでも可)。使ったコードは作り直す", () => {
    const { policy } = setup();
    const code = policy.setupCode();
    policy.claimWithSetupCode("First@Example.com", code.replace(/-/g, "").toLowerCase());
    expect(policy.storedEmails()).toEqual(["first@example.com"]);
    expect(policy.isAdmin("first@example.com")).toBe(true);
    expect(policy.needsSetup()).toBe(false);
    expect(policy.setupCode()).not.toBe(code);
  });

  it("セットアップコードが違えば forbidden", () => {
    const { policy } = setup();
    policy.setupCode();
    expectAppError(() => policy.claimWithSetupCode("a@example.com", "WRONG-CODE"), "forbidden");
    expect(policy.needsSetup()).toBe(true);
  });

  it("管理者が既にいればセットアップコードは使えない", () => {
    const { policy } = setup(["admin@example.com"]);
    const code = policy.setupCode();
    expectAppError(() => policy.claimWithSetupCode("a@example.com", code), "forbidden");
  });

  it("プレースホルダメール (X ログイン) では管理者になれない", () => {
    const { policy } = setup();
    const code = policy.setupCode();
    expectAppError(
      () => policy.claimWithSetupCode("123@x.placeholder.invalid", code),
      "invalid_input",
    );
    expect(policy.needsSetup()).toBe(true);
  });

  it("addEmail は小文字化して追加し、重複や不正な値を受け付けない", () => {
    const { policy } = setup(["admin@example.com"]);
    policy.addEmail(" New@Example.com ");
    policy.addEmail("new@example.com");
    expect(policy.storedEmails()).toEqual(["new@example.com"]);
    expectAppError(() => policy.addEmail("not-an-email"), "invalid_input");
    expectAppError(() => policy.addEmail("a@x.placeholder.invalid"), "invalid_input");
  });

  it("removeEmail は settings 表から削除する。環境変数の管理者は削除できない", () => {
    const { policy } = setup(["admin@example.com"]);
    policy.addEmail("second@example.com");
    policy.removeEmail("SECOND@example.com");
    expect(policy.storedEmails()).toEqual([]);
    policy.removeEmail("admin@example.com");
    expect(policy.envEmails()).toEqual(["admin@example.com"]);
  });

  it("最後の管理者は削除できない", () => {
    const { policy } = setup();
    policy.claimWithSetupCode("only@example.com", policy.setupCode());
    expectAppError(() => policy.removeEmail("only@example.com"), "invalid_input");
    expect(policy.storedEmails()).toEqual(["only@example.com"]);

    policy.addEmail("second@example.com");
    policy.removeEmail("only@example.com");
    expect(policy.storedEmails()).toEqual(["second@example.com"]);
  });
});
