import { describe, expect, it } from "vitest";
import { FakeSettingsRepository } from "../app/fake-repository.ts";
import { AUTH_SECRET_SETTINGS_KEY, resolveAuthSecret } from "./auth-secret.ts";

describe("resolveAuthSecret", () => {
  it("環境変数があればそれを使い、settings 表には何も書かない", () => {
    const settings = new FakeSettingsRepository();
    expect(resolveAuthSecret("from-env", settings)).toBe("from-env");
    expect(settings.get(AUTH_SECRET_SETTINGS_KEY)).toBeUndefined();
  });

  it("環境変数が settings 表の値より優先される", () => {
    const settings = new FakeSettingsRepository();
    settings.set(AUTH_SECRET_SETTINGS_KEY, "stored");
    expect(resolveAuthSecret("from-env", settings)).toBe("from-env");
  });

  it("環境変数が無ければ生成して settings 表に保存し、以後は同じ値を返す", () => {
    const settings = new FakeSettingsRepository();
    const first = resolveAuthSecret(undefined, settings);
    // 32 バイトの base64 (44 文字)。
    expect(first).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(settings.get(AUTH_SECRET_SETTINGS_KEY)).toBe(first);
    expect(resolveAuthSecret(undefined, settings)).toBe(first);
    expect(resolveAuthSecret("", settings)).toBe(first);
  });

  it("別の settings 表では別の値を生成する", () => {
    const a = resolveAuthSecret(undefined, new FakeSettingsRepository());
    const b = resolveAuthSecret(undefined, new FakeSettingsRepository());
    expect(a).not.toBe(b);
  });
});
