// Workers Cache の purge (cache-purge.ts / CachedPages.purgeEverything) の確認。
// テスト環境 (miniflare) には purge の API が無いため、CachedPages は unsupported を返す。
// DO 側の DurableObjectCachePurger は、ctx.exports を差し替えて成功・失敗の扱いを確かめる。
import { exports } from "cloudflare:workers";
import { FakeSettingsRepository } from "@hakoniwajs/core";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CachePurgeOutcome } from "../src/cached-pages.ts";
import { CACHE_PURGE_PENDING_SETTINGS_KEY, DurableObjectCachePurger } from "../src/cache-purge.ts";
import { loginAsAdmin, mainGameStub } from "./helpers.ts";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

function fakeState(purgeEverything?: () => Promise<CachePurgeOutcome>): DurableObjectState {
  return {
    exports: purgeEverything === undefined ? {} : { CachedPages: { purgeEverything } },
  } as unknown as DurableObjectState;
}

describe("CachedPages.purgeEverything", () => {
  it("purge の API が無い環境では unsupported を返す (例外は投げない)", async () => {
    const cachedPages = (
      exports as unknown as Record<string, { purgeEverything(): Promise<CachePurgeOutcome> }>
    )["CachedPages"];
    const outcome = await cachedPages?.purgeEverything();
    expect(outcome?.success).toBe(false);
    expect(outcome?.unsupported).toBe(true);
  });
});

describe("DurableObjectCachePurger", () => {
  it("成功すれば、失敗の印を消す", async () => {
    const settings = new FakeSettingsRepository();
    settings.set(CACHE_PURGE_PENDING_SETTINGS_KEY, "site-settings");
    let calls = 0;
    const purger = new DurableObjectCachePurger(
      fakeState(async () => {
        calls += 1;
        return { success: true, errors: [] };
      }),
      settings,
    );
    await purger.purgeAll("start-game");
    expect(calls).toBe(1);
    expect(purger.pendingReason()).toBeUndefined();
  });

  it("失敗 (回数の上限など) すれば印を残し、retryPending でやり直す", async () => {
    const settings = new FakeSettingsRepository();
    const outcomes: CachePurgeOutcome[] = [
      { success: false, errors: [{ code: 1015, message: "rate limited" }] },
      { success: true, errors: [] },
    ];
    const purger = new DurableObjectCachePurger(
      fakeState(async () => outcomes.shift() ?? { success: true, errors: [] }),
      settings,
    );
    await purger.purgeAll("site-settings");
    expect(purger.pendingReason()).toBe("site-settings");
    await purger.retryPending();
    expect(purger.pendingReason()).toBeUndefined();
    expect(outcomes).toHaveLength(0);
  });

  it("RPC が例外を投げても例外にせず、印を残す", async () => {
    const settings = new FakeSettingsRepository();
    const purger = new DurableObjectCachePurger(
      fakeState(async () => {
        throw new Error("boom");
      }),
      settings,
    );
    await expect(purger.purgeAll("reset")).resolves.toBeUndefined();
    expect(purger.pendingReason()).toBe("reset");
  });

  it("purge の API が無い (unsupported) なら印を残さない", async () => {
    const settings = new FakeSettingsRepository();
    const purger = new DurableObjectCachePurger(
      fakeState(async () => ({ success: false, unsupported: true, errors: [] })),
      settings,
    );
    await purger.purgeAll("site-settings");
    expect(purger.pendingReason()).toBeUndefined();
  });

  it("CachedPages が無い (キャッシュを使っていない) なら何もしない", async () => {
    const settings = new FakeSettingsRepository();
    const purger = new DurableObjectCachePurger(fakeState(), settings);
    await purger.purgeAll("site-settings");
    await purger.retryPending();
    expect(purger.pendingReason()).toBeUndefined();
    expect(settings.get(CACHE_PURGE_PENDING_SETTINGS_KEY)).toBeUndefined();
  });

  it("retryPending は印が無ければ purge しない", async () => {
    let calls = 0;
    const purger = new DurableObjectCachePurger(
      fakeState(async () => {
        calls += 1;
        return { success: true, errors: [] };
      }),
      new FakeSettingsRepository(),
    );
    await purger.retryPending();
    expect(calls).toBe(0);
  });
});

describe("HakoniwaGame (DO) の管理操作", () => {
  it("サイト設定の変更で CachedPages の purge を呼び、purge できなくても管理操作は成功する", async () => {
    const warn = vi.spyOn(console, "warn");
    const { cookie, csrfToken } = await loginAsAdmin();
    const res = await mainGameStub().fetch("http://example.com/admin/site-settings", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "しま", timezone: "UTC", _csrf: csrfToken }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("サイト設定を変更しました");
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes("purge できません (site-settings)")),
    ).toBe(true);
  });
});
