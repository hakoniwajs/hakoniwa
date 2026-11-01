import { describe, expect, it } from "vite-plus/test";
import { AuthMethodPolicy } from "./auth-methods.ts";
import type { SettingsRepository } from "./ports.ts";

class FakeSettings implements SettingsRepository {
  #store = new Map<string, string>();

  get(key: string): string | undefined {
    return this.#store.get(key);
  }

  set(key: string, value: string): void {
    this.#store.set(key, value);
  }
}

describe("AuthMethodPolicy", () => {
  it("settings に行が無ければ、設定済みの方法はすべて有効", () => {
    const settings = new FakeSettings();
    const policy = new AuthMethodPolicy({
      configured: { x: true, discord: false, email: true },
      settings,
    });
    expect(policy.enabled()).toEqual({ x: true, discord: false, email: true });
  });

  it("setEnabled で無効化すると enabled() に反映される", () => {
    const settings = new FakeSettings();
    const policy = new AuthMethodPolicy({
      configured: { x: true, discord: true, email: true },
      settings,
    });
    policy.setEnabled({ x: false, discord: true, email: true });
    expect(policy.enabled()).toEqual({ x: false, discord: true, email: true });
  });

  it("設定済みでない方法は setEnabled で true にしても enabled() は false のまま", () => {
    const settings = new FakeSettings();
    const policy = new AuthMethodPolicy({
      configured: { x: false, discord: true, email: true },
      settings,
    });
    policy.setEnabled({ x: true, discord: true, email: true });
    expect(policy.enabled().x).toBe(false);
  });

  it("configured() は configured の複製を返す", () => {
    const settings = new FakeSettings();
    const configured = { x: true, discord: false, email: true };
    const policy = new AuthMethodPolicy({ configured, settings });
    const result = policy.configured();
    expect(result).toEqual(configured);
    expect(result).not.toBe(configured);
  });

  it("壊れた JSON が settings に入っていても例外を投げず、すべて有効扱いにする", () => {
    const settings = new FakeSettings();
    settings.set("auth.methods", "not json");
    const policy = new AuthMethodPolicy({
      configured: { x: true, discord: true, email: true },
      settings,
    });
    expect(policy.enabled()).toEqual({ x: true, discord: true, email: true });
  });
});
