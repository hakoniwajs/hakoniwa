// tmp/16-season.md 「タイムゾーン」節のテスト。Asia/Tokyo (固定 +9、DST なし) と UTC の両方を検証する。
import { describe, expect, it } from "vite-plus/test";
import { formatDateTime, formatDateTimeLocalValue, parseLocalDateTime } from "./timezone.ts";

describe("parseLocalDateTime", () => {
  it("Asia/Tokyo: ローカル時刻から unix 秒 (UTC-9h) を求める", () => {
    // 2026-01-01T09:00 (JST) === 2026-01-01T00:00 (UTC)
    const unix = parseLocalDateTime("2026-01-01T09:00", "Asia/Tokyo");
    expect(unix).toBe(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);
  });

  it("UTC: ローカル時刻がそのまま unix 秒になる", () => {
    const unix = parseLocalDateTime("2026-01-01T00:00", "UTC");
    expect(unix).toBe(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);
  });

  it("秒を含む値も解釈できる", () => {
    const unix = parseLocalDateTime("2026-01-01T00:00:30", "UTC");
    expect(unix).toBe(Date.UTC(2026, 0, 1, 0, 0, 30) / 1000);
  });

  it("不正な形式は Error を投げる", () => {
    expect(() => parseLocalDateTime("not-a-date", "UTC")).toThrow();
  });
});

describe("formatDateTime", () => {
  it("Asia/Tokyo: UTC から +9h した表示になる", () => {
    const unix = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;
    expect(formatDateTime(unix, "Asia/Tokyo")).toBe("2026/01/01 09:00");
  });

  it("UTC: そのままの時刻で表示する", () => {
    const unix = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;
    expect(formatDateTime(unix, "UTC")).toBe("2026/01/01 00:00");
  });
});

describe("formatDateTimeLocalValue", () => {
  it("datetime-local の value 形式 (YYYY-MM-DDTHH:mm) を返す", () => {
    const unix = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;
    expect(formatDateTimeLocalValue(unix, "Asia/Tokyo")).toBe("2026-01-01T09:00");
    expect(formatDateTimeLocalValue(unix, "UTC")).toBe("2026-01-01T00:00");
  });
});

describe("往復変換", () => {
  it("parseLocalDateTime → formatDateTimeLocalValue で元の値に戻る (Asia/Tokyo)", () => {
    const value = "2026-06-15T14:30";
    const unix = parseLocalDateTime(value, "Asia/Tokyo");
    expect(formatDateTimeLocalValue(unix, "Asia/Tokyo")).toBe(value);
  });

  it("parseLocalDateTime → formatDateTimeLocalValue で元の値に戻る (UTC)", () => {
    const value = "2026-06-15T14:30";
    const unix = parseLocalDateTime(value, "UTC");
    expect(formatDateTimeLocalValue(unix, "UTC")).toBe(value);
  });
});
