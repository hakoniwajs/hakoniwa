import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../core/config.ts";
import { aboutMoney, buildMoneyDisplay } from "./view-models.ts";

describe("aboutMoney", () => {
  it("500未満なら「推定500億円未満」", () => {
    expect(aboutMoney(0, "億円")).toBe("推定500億円未満");
    expect(aboutMoney(499, "億円")).toBe("推定500億円未満");
  });

  it("500以上なら1000単位に丸めて「推定N000億円」", () => {
    expect(aboutMoney(500, "億円")).toBe("推定1000億円");
    expect(aboutMoney(1500, "億円")).toBe("推定2000億円");
    // int((1000+500)/1000) = int(1.5) = 1 (Perl の int() は切り捨て)。
    expect(aboutMoney(1000, "億円")).toBe("推定1000億円");
  });
});

describe("buildMoneyDisplay", () => {
  it("hideMoneyMode 0 かつ観光者なら hidden", () => {
    const config = { ...defaultConfig, hideMoneyMode: 0 as const };
    expect(buildMoneyDisplay(1000, config, false)).toEqual({ mode: "hidden" });
  });

  it("hideMoneyMode 1 なら常に exact", () => {
    const config = { ...defaultConfig, hideMoneyMode: 1 as const };
    expect(buildMoneyDisplay(1234, config, false)).toEqual({ mode: "exact", value: 1234 });
  });

  it("hideMoneyMode 2 かつ観光者なら about", () => {
    const config = { ...defaultConfig, hideMoneyMode: 2 as const };
    expect(buildMoneyDisplay(1500, config, false)).toEqual({
      mode: "about",
      text: "推定2000億円",
    });
  });

  it("開発画面 (owner) なら hideMoneyMode に関係なく exact", () => {
    const config = { ...defaultConfig, hideMoneyMode: 0 as const };
    expect(buildMoneyDisplay(1234, config, true)).toEqual({ mode: "exact", value: 1234 });
  });
});
