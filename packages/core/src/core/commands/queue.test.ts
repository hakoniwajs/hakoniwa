import { describe, expect, it } from "vite-plus/test";
import { CommandKind, LandKind } from "../constants.ts";
import { createTerrain } from "../terrain.ts";
import type { Command } from "../types.ts";
import { doNothingCommand } from "../types.ts";
import {
  autoPrepare,
  clearAll,
  deleteAt,
  insertAt,
  slideBack,
  slideFront,
  writeAt,
} from "./queue.ts";

const MAX = 5;

function makeCommands(max = MAX): Command[] {
  return Array.from({ length: max }, (_, i) => ({
    kind: CommandKind.Prepare,
    target: 0,
    x: i,
    y: i,
    arg: 0,
  }));
}

describe("slideFront", () => {
  it("index を削除し、末尾に資金繰りを補充する。長さは max のまま", () => {
    const commands = makeCommands();
    slideFront(commands, 1, MAX);
    expect(commands).toHaveLength(MAX);
    expect(commands.map((c) => c.x)).toEqual([0, 2, 3, 4, 0]);
    expect(commands[MAX - 1]).toEqual(doNothingCommand);
  });

  it("先頭を削除しても長さは変わらない", () => {
    const commands = makeCommands();
    slideFront(commands, 0, MAX);
    expect(commands).toHaveLength(MAX);
    expect(commands.map((c) => c.x)).toEqual([1, 2, 3, 4, 0]);
  });
});

describe("slideBack", () => {
  it("末尾なら何もしない (B10)", () => {
    const commands = makeCommands();
    const before = commands.map((c) => ({ ...c }));
    slideBack(commands, MAX - 1);
    expect(commands).toHaveLength(MAX);
    expect(commands).toEqual(before);
  });

  it("末尾以外なら、index の位置に現在の値のコピーを挿入し、末尾を捨てる", () => {
    const commands = makeCommands();
    slideBack(commands, 1);
    expect(commands).toHaveLength(MAX);
    // 元: [0,1,2,3,4] -> index1に現在値(1)のコピーを挿入、末尾(4)を捨てる -> [0,1,1,2,3]
    expect(commands.map((c) => c.x)).toEqual([0, 1, 1, 2, 3]);
  });

  it("先頭 (index=0) でも動作する", () => {
    const commands = makeCommands();
    slideBack(commands, 0);
    expect(commands.map((c) => c.x)).toEqual([0, 0, 1, 2, 3]);
    expect(commands).toHaveLength(MAX);
  });
});

describe("writeAt / insertAt / deleteAt", () => {
  it("writeAt は指定位置を置き換える。長さは変わらない", () => {
    const commands = makeCommands();
    const newCommand: Command = { kind: CommandKind.Money, target: 3, x: 9, y: 9, arg: 1 };
    writeAt(commands, 2, newCommand);
    expect(commands[2]).toEqual(newCommand);
    expect(commands).toHaveLength(MAX);
  });

  it("insertAt は slideBack してから書き込む。長さは変わらない", () => {
    const commands = makeCommands();
    const newCommand: Command = { kind: CommandKind.Money, target: 3, x: 9, y: 9, arg: 1 };
    insertAt(commands, 1, newCommand);
    expect(commands).toHaveLength(MAX);
    expect(commands[1]).toEqual(newCommand);
    // 元index1(x=1)がindex2にずれ、末尾(x=4)が捨てられる
    expect(commands.map((c) => c.x)).toEqual([0, 9, 1, 2, 3]);
  });

  it("deleteAt は slideFront と同じ (削除して末尾に資金繰り)。長さは変わらない", () => {
    const commands = makeCommands();
    deleteAt(commands, 2, MAX);
    expect(commands).toHaveLength(MAX);
    expect(commands.map((c) => c.x)).toEqual([0, 1, 3, 4, 0]);
    expect(commands[MAX - 1]).toEqual(doNothingCommand);
  });
});

describe("clearAll", () => {
  it("すべて資金繰りにする。長さは max のまま", () => {
    const commands = makeCommands();
    clearAll(commands, MAX);
    expect(commands).toHaveLength(MAX);
    for (const command of commands) {
      expect(command).toEqual(doNothingCommand);
    }
  });
});

describe("autoPrepare", () => {
  it("荒地だけを拾い、同じ index へ挿入し続ける (見つかった順とは逆順で手前に並ぶ)", () => {
    const size = 4;
    const terrain = createTerrain(size);
    // (0,0),(1,1),(2,2) を荒地にする。他は海のまま。
    terrain.setKind(0, 0, LandKind.Waste, 0);
    terrain.setKind(1, 1, LandKind.Waste, 0);
    terrain.setKind(2, 2, LandKind.Waste, 0);

    // target を 100+i にして元のコマンドと新規挿入コマンド (target=0) を区別できるようにする。
    const commands: Command[] = Array.from({ length: MAX }, (_, i) => ({
      kind: CommandKind.Prepare,
      target: 100 + i,
      x: i,
      y: i,
      arg: 0,
    }));
    const points = [
      { x: 3, y: 3 }, // 海: スキップ
      { x: 0, y: 0 }, // 荒地: 挿入対象
      { x: 1, y: 1 }, // 荒地: 挿入対象
      { x: 2, y: 2 }, // 荒地: 挿入対象
    ];

    autoPrepare(commands, 0, terrain, CommandKind.Prepare, points, MAX);

    expect(commands).toHaveLength(MAX);
    expect(commands).toEqual([
      { kind: CommandKind.Prepare, target: 0, x: 2, y: 2, arg: 0 },
      { kind: CommandKind.Prepare, target: 0, x: 1, y: 1, arg: 0 },
      { kind: CommandKind.Prepare, target: 0, x: 0, y: 0, arg: 0 },
      { kind: CommandKind.Prepare, target: 100, x: 0, y: 0, arg: 0 },
      { kind: CommandKind.Prepare, target: 101, x: 1, y: 1, arg: 0 },
    ]);
  });

  it("挿入数は max を超えない", () => {
    const size = 4;
    const terrain = createTerrain(size);
    const points: { x: number; y: number }[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        terrain.setKind(x, y, LandKind.Waste, 0);
        points.push({ x, y });
      }
    }
    const commands = makeCommands(3);
    autoPrepare(commands, 0, terrain, CommandKind.Prepare2, points, 3);
    expect(commands).toHaveLength(3);
    for (const command of commands) {
      expect(command.kind).toBe(CommandKind.Prepare2);
    }
  });

  it("荒地が全くなければ何も挿入しない", () => {
    const terrain = createTerrain(2);
    const commands = makeCommands(2);
    const before = commands.map((c) => ({ ...c }));
    autoPrepare(
      commands,
      0,
      terrain,
      CommandKind.Prepare,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      2,
    );
    expect(commands).toEqual(before);
  });
});
