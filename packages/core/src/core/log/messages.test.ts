import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../config.ts";
import { LogCollector } from "./collector.ts";
import * as messages from "./messages.ts";

function firstHtml(log: LogCollector): string {
  const { logs } = log.flush();
  return logs[0]!.html;
}

describe("logNoMoney", () => {
  it("通常ログとして id 宛に出す", () => {
    const log = new LogCollector(1);
    messages.logNoMoney(log, 3, "たろう", "整地");
    const { logs } = log.flush();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.secret).toBe(false);
    expect(logs[0]!.islandId).toBe(3);
    expect(logs[0]!.targetId).toBe(0);
    expect(logs[0]!.html).toBe(
      '<span class="island-name">たろう島</span>で予定されていた<span class="command-name">整地</span>は、資金不足のため中止されました。',
    );
  });
});

describe("logLandSuc", () => {
  it("島名+座標をひとつの name() タグで包む", () => {
    const log = new LogCollector(1);
    messages.logLandSuc(log, 1, "たろう", "整地", "(3, 4)");
    expect(firstHtml(log)).toBe(
      '<span class="island-name">たろう島(3, 4)</span>で<span class="command-name">整地</span>が行われました。',
    );
  });
});

describe("logPBSuc", () => {
  it("secret ログと normal ログの 2 本を出す", () => {
    const log = new LogCollector(1);
    messages.logPBSuc(log, 1, "たろう", "植林", "(3, 4)");
    const { logs } = log.flush();
    // flush は secret を先頭に出す (逆順でも1件なので順序そのまま)
    expect(logs).toHaveLength(2);
    expect(logs[0]!.secret).toBe(true);
    expect(logs[0]!.html).toContain("植林");
    expect(logs[1]!.secret).toBe(false);
    expect(logs[1]!.html).toContain("森");
  });
});

describe("logMsOutS (ステルスミサイル: 範囲外)", () => {
  it("攻撃側に secret、標的側に late で「何者か」ログを出す", () => {
    const log = new LogCollector(1);
    messages.logMsOutS(log, 1, 2, "たろう", "じろう", "ステルスミサイル", "(1, 1)");
    const { logs } = log.flush();
    expect(logs).toHaveLength(2);
    const secretEntry = logs.find((l) => l.secret)!;
    const lateEntry = logs.find((l) => !l.secret)!;
    expect(secretEntry.islandId).toBe(1);
    expect(secretEntry.targetId).toBe(2);
    expect(secretEntry.html).toContain("たろう島");
    expect(lateEntry.islandId).toBe(2);
    expect(lateEntry.targetId).toBe(0);
    expect(lateEntry.html).toContain("何者か");
    expect(lateEntry.html).not.toContain("たろう島");
  });
});

describe("logMsMonNoDamageS (B3)", () => {
  it("標的側は late (Perl の logOut ではなく late にする)", () => {
    const log = new LogCollector(1);
    messages.logMsMonNoDamageS(
      log,
      1,
      2,
      "たろう",
      "じろう",
      "ミサイル",
      "怪獣",
      "(0, 0)",
      "(1, 1)",
    );
    const { logs } = log.flush();
    expect(logs).toHaveLength(2);
    const secretEntry = logs.find((l) => l.secret)!;
    const lateEntry = logs.find((l) => !l.secret)!;
    expect(secretEntry.islandId).toBe(1);
    expect(lateEntry.islandId).toBe(2);
    expect(lateEntry.html).toContain("何者か");
  });
});

describe("logDoNothing (B25)", () => {
  it("何も出力しない", () => {
    const log = new LogCollector(1);
    messages.logDoNothing(log, 1, "たろう", "資金繰り");
    const { logs, history } = log.flush();
    expect(logs).toEqual([]);
    expect(history).toEqual([]);
  });
});

describe("単位を必要とする関数 (config)", () => {
  it("logMsMonMoney は config.units.money を使う", () => {
    const log = new LogCollector(1);
    messages.logMsMonMoney(log, 5, "いのら", 400, defaultConfig);
    expect(firstHtml(log)).toContain(`400${defaultConfig.units.money}`);
  });

  it("logMsBoatPeople は config.units.pop を使う", () => {
    const log = new LogCollector(1);
    messages.logMsBoatPeople(log, 1, "たろう", 12, defaultConfig);
    expect(firstHtml(log)).toContain(`12${defaultConfig.units.pop}`);
  });

  it("logSell は config.units.food を使う", () => {
    const log = new LogCollector(1);
    messages.logSell(log, 1, "たろう", "食料輸出", 300, defaultConfig);
    expect(firstHtml(log)).toContain(`300${defaultConfig.units.food}`);
  });

  it("logMaizo は config.units.money を使う", () => {
    const log = new LogCollector(1);
    messages.logMaizo(log, 1, "たろう", "整地", 500, defaultConfig);
    expect(firstHtml(log)).toContain(`500${defaultConfig.units.money}`);
  });
});

describe("logGiveup / logDead / logPrize (normal + history)", () => {
  it("logGiveup は normal と history の両方を出す", () => {
    const log = new LogCollector(3);
    messages.logGiveup(log, 1, "たろう");
    const { logs, history } = log.flush();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.islandId).toBe(1);
    expect(history).toHaveLength(1);
    expect(history[0]!.html).toContain("放棄");
  });

  it("logPrize は normal と history の両方を出す", () => {
    const log = new LogCollector(3);
    messages.logPrize(log, 1, "たろう", "ターン杯");
    const { logs, history } = log.flush();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.html).toContain("ターン杯");
    expect(history).toHaveLength(1);
    expect(history[0]!.html).toContain("ターン杯");
  });
});

describe("logDiscover / logChangeName (history のみ)", () => {
  it("logDiscover はログを出さず history だけ", () => {
    const log = new LogCollector(1);
    messages.logDiscover(log, "たろう");
    const { logs, history } = log.flush();
    expect(logs).toEqual([]);
    expect(history).toHaveLength(1);
  });
});

describe("入力文字列のエスケープ", () => {
  it("島名に HTML 特殊文字が含まれてもエスケープされる", () => {
    const log = new LogCollector(1);
    messages.logEarthquake(log, 1, "<script>");
    expect(firstHtml(log)).not.toContain("<script>島");
    expect(firstHtml(log)).toContain("&lt;script&gt;島");
  });
});
