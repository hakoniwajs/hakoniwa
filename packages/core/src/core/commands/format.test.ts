import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../config.ts";
import { CommandKind } from "../constants.ts";
import type { Command } from "../types.ts";
import { formatCommand } from "./format.ts";

const islandNames = new Map<number, string>([
  [1, "たろう"],
  [2, "じろう"],
]);
const resolveIslandName = (id: number): string | undefined => islandNames.get(id);

function cmd(partial: Partial<Command>): Command {
  return { kind: CommandKind.DoNothing, target: 0, x: 0, y: 0, arg: 0, ...partial };
}

describe("formatCommand", () => {
  it("番号は 2 桁 + '：' で表記する", () => {
    const result = formatCommand(cmd({}), 0, defaultConfig, resolveIslandName);
    expect(result.number).toBe("01：");
    const result2 = formatCommand(cmd({}), 9, defaultConfig, resolveIslandName);
    expect(result2.number).toBe("10：");
  });

  it("資金繰り / 島の放棄はコマンド名のみ", () => {
    expect(
      formatCommand(cmd({ kind: CommandKind.DoNothing }), 0, defaultConfig, resolveIslandName).text,
    ).toBe("資金繰り");
    expect(
      formatCommand(cmd({ kind: CommandKind.Giveup }), 0, defaultConfig, resolveIslandName).text,
    ).toBe("島の放棄");
  });

  it("整地は座標付き", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.Prepare, x: 3, y: 4 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe("(3,4)で整地");
  });

  it("ミサイル発射: 相手島名 + 座標 + 発射数", () => {
    const unlimited = formatCommand(
      cmd({ kind: CommandKind.MissileNM, target: 1, x: 2, y: 3, arg: 0 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(unlimited.text).toBe("たろう島(2,3)へミサイル発射(無制限)");

    const limited = formatCommand(
      cmd({ kind: CommandKind.MissileNM, target: 1, x: 2, y: 3, arg: 5 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(limited.text).toBe("たろう島(2,3)へミサイル発射(5発)");
  });

  it("ミサイル発射: 対象島が存在しない場合は「無人島」", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.MissileNM, target: 999, x: 2, y: 3, arg: 0 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe("無人島(2,3)へミサイル発射(無制限)");
  });

  it("怪獣派遣: 相手島名のみ (座標なし)", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.SendMonster, target: 2 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe("じろう島へ怪獣派遣");
  });

  it("食料輸出: コマンド名 + 数量 (食料単位)", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.Sell, arg: 1 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    // Sell の cost は -100 (食料)。arg=1 -> value = -100 -> 100トン表記。
    expect(result.text).toBe(`食料輸出100${defaultConfig.units.food}`);
  });

  it("資金援助: 対象島名 + コマンド名 + 金額", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.Money, target: 1, arg: 1 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe(`たろう島へ資金援助100${defaultConfig.units.money}`);
  });

  it("食料援助: 対象島名 + コマンド名 + 食料量", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.Food, target: 2, arg: 1 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe(`じろう島へ食料援助100${defaultConfig.units.food}`);
  });

  it("掘削: arg=0 なら座標のみ、arg!=0 なら予算表示", () => {
    const noArg = formatCommand(
      cmd({ kind: CommandKind.Destroy, x: 1, y: 1 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(noArg.text).toBe("(1,1)で掘削");

    const withArg = formatCommand(
      cmd({ kind: CommandKind.Destroy, x: 1, y: 1, arg: 2 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(withArg.text).toBe(`(1,1)で掘削(予算400${defaultConfig.units.money})`);
  });

  it("農場整備: arg=0 なら座標のみ、arg!=0 なら回数表示", () => {
    const noArg = formatCommand(
      cmd({ kind: CommandKind.Farm, x: 0, y: 0 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(noArg.text).toBe("(0,0)で農場整備");

    const withArg = formatCommand(
      cmd({ kind: CommandKind.Farm, x: 0, y: 0, arg: 3 }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(withArg.text).toBe("(0,0)で農場整備(3回)");
  });

  it("誘致活動はコマンド名のみ", () => {
    const result = formatCommand(
      cmd({ kind: CommandKind.Propaganda }),
      0,
      defaultConfig,
      resolveIslandName,
    );
    expect(result.text).toBe("誘致活動");
  });
});
