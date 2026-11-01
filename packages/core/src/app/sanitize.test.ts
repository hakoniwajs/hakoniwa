import { describe, expect, it } from "vite-plus/test";
import { cutColumn, isBadIslandName, sanitizeText, stripControlAndComma } from "./sanitize.ts";

describe("stripControlAndComma", () => {
  it("制御文字とカンマを除去する", () => {
    expect(stripControlAndComma("a,b\x00c\x1fd")).toBe("abcd");
  });

  it("通常の文字はそのまま", () => {
    expect(stripControlAndComma("島の名前")).toBe("島の名前");
  });
});

describe("cutColumn", () => {
  it("上限以下ならそのまま", () => {
    expect(cutColumn("abc", 5)).toBe("abc");
  });

  it("コードポイント数で切り詰める (サロゲートペアも1文字扱い)", () => {
    expect(cutColumn("あいうえお", 3)).toBe("あいう");
  });
});

describe("sanitizeText", () => {
  it("除去してから切り詰める", () => {
    expect(sanitizeText("あ,い,う,え,お", 3)).toBe("あいう");
  });
});

describe("isBadIslandName", () => {
  it.each([",", "?", "(", ")", "<", ">", "$"])("%s を含む名前は使えない", (bad) => {
    expect(isBadIslandName(`island${bad}`)).toBe(true);
  });

  it("「無人」は使えない", () => {
    expect(isBadIslandName("無人")).toBe(true);
  });

  it("通常の名前は使える", () => {
    expect(isBadIslandName("テスト島")).toBe(false);
  });
});
