import { describe, expect, it } from "vitest";
import { FakeSettingsRepository } from "./fake-repository.ts";
import {
  defaultSiteSettings,
  isValidTimeZone,
  parseNgWordsText,
  SITE_SETTINGS_KEY,
  SiteSettingsService,
  toSiteRenderSettings,
} from "./site-settings.ts";
import type { SiteSettings } from "./site-settings.ts";

function setup(fallback: SiteSettings = defaultSiteSettings) {
  const settings = new FakeSettingsRepository();
  return { settings, service: new SiteSettingsService({ settings, fallback }) };
}

describe("SiteSettingsService", () => {
  it("settings 表に値が無ければ fallback (環境変数 > 既定値) を返す", () => {
    const fallback: SiteSettings = {
      ...defaultSiteSettings,
      title: "かんきょうへんすう",
      useLbbs: true,
      ngWords: ["えぬじー"],
    };
    const { service } = setup(fallback);
    expect(service.get()).toEqual(fallback);
  });

  it("update で保存した値が fallback より優先され、次の get() からすぐ反映される", () => {
    const { service } = setup({ ...defaultSiteSettings, title: "かんきょうへんすう" });
    const next: SiteSettings = {
      title: "かんりがめん",
      adminName: "かんりにん",
      email: "admin@example.com",
      bbsUrl: "https://example.com/bbs",
      topPageUrl: "https://example.com/",
      ngWords: ["いち", "に"],
      useLbbs: true,
      timezone: "UTC",
    };
    service.update(next);
    expect(service.get()).toEqual(next);
  });

  it("保存値に無い項目・型の違う項目・不正なタイムゾーンは項目ごとに fallback を使う", () => {
    const fallback: SiteSettings = { ...defaultSiteSettings, adminName: "ふぉーるばっく" };
    const { settings, service } = setup(fallback);
    settings.set(
      SITE_SETTINGS_KEY,
      JSON.stringify({ title: "ほぞん", useLbbs: "yes", timezone: "Not/AZone", ngWords: [1, "a"] }),
    );
    expect(service.get()).toEqual({
      ...fallback,
      title: "ほぞん",
      ngWords: ["a"],
    });
  });

  it("壊れた JSON や空のタイトルは無視する", () => {
    const { settings, service } = setup();
    settings.set(SITE_SETTINGS_KEY, "{not json");
    expect(service.get()).toEqual(defaultSiteSettings);
    settings.set(SITE_SETTINGS_KEY, JSON.stringify({ title: "" }));
    expect(service.get().title).toBe(defaultSiteSettings.title);
  });

  it("get() の ngWords を書き換えても保存値・fallback に影響しない", () => {
    const { service } = setup({ ...defaultSiteSettings, ngWords: ["a"] });
    service.get().ngWords.push("b");
    expect(service.get().ngWords).toEqual(["a"]);
  });
});

describe("parseNgWordsText", () => {
  it("改行・カンマのどちらでも区切れ、空要素と重複を除く", () => {
    expect(parseNgWordsText(" いち\r\nに, さん\n\nに,,")).toEqual(["いち", "に", "さん"]);
    expect(parseNgWordsText("")).toEqual([]);
  });
});

describe("isValidTimeZone", () => {
  it("IANA タイムゾーン名だけ受け付ける", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("toSiteRenderSettings", () => {
  it("描画に必要な項目だけを取り出す (NG ワードを含めない)", () => {
    const render = toSiteRenderSettings({ ...defaultSiteSettings, ngWords: ["ひみつ"] });
    expect(render).not.toHaveProperty("ngWords");
    expect(render.title).toBe(defaultSiteSettings.title);
  });
});
