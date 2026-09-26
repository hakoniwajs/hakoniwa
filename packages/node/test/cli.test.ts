// tmp/08-turn-trigger-admin-cli.md 「CLI」節、tmp/10-implementation-plan.md Phase 5 のテスト。
// 子プロセスで dist/cli.js を叩くのではなく、runCli(argv, env, io) を直接呼ぶ。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import type { CliIO } from "../src/cli.ts";

function createIO(): CliIO & { lines: string[]; errLines: string[] } {
  const lines: string[] = [];
  const errLines: string[] = [];
  return {
    lines,
    errLines,
    stdout: (line: string) => {
      lines.push(line);
    },
    stderr: (line: string) => {
      errLines.push(line);
    },
  };
}

describe("cli", () => {
  let dir: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hakoniwa-cli-test-"));
    env = {
      HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
      HAKONIWA_BACKUP_DIR: join(dir, "backups"),
      // v2 (better-auth) で必須になった環境変数 (14-users-auth.md)。
      HAKONIWA_AUTH_SECRET: "a".repeat(32),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("--help は使い方を表示して 0 を返す", async () => {
    const io = createIO();
    const code = await runCli(["--help"], env, io);
    expect(code).toBe(0);
    expect(io.lines.join("\n")).toContain("使い方: hakoniwa <command>");
  });

  it("引数なしは使い方を stderr に表示して 2 を返す", async () => {
    const io = createIO();
    const code = await runCli([], env, io);
    expect(code).toBe(2);
    expect(io.errLines.join("\n")).toContain("使い方: hakoniwa <command>");
  });

  it("未知のコマンドは 2 を返す", async () => {
    const io = createIO();
    const code = await runCli(["nosuch"], env, io);
    expect(code).toBe(2);
    expect(io.errLines.join("\n")).toContain("未知のコマンドです");
  });

  it("db status は未初期化なら「未初期化」を表示する", async () => {
    const io = createIO();
    const code = await runCli(["db", "status"], env, io);
    expect(code).toBe(0);
    expect(io.lines.join("\n")).toContain("未初期化");
  });

  it("db reset は --yes なしだと 2 を返す", async () => {
    const io = createIO();
    const code = await runCli(["db", "reset"], env, io);
    expect(code).toBe(2);
    expect(io.errLines.join("\n")).toContain("--yes");
  });

  it("db init → db status → turn advance → db status → backup create → backup list", async () => {
    const initIO = createIO();
    expect(await runCli(["db", "init"], env, initIO)).toBe(0);
    expect(initIO.lines.join("\n")).toContain("新しいデータを作成しました");

    const status1IO = createIO();
    expect(await runCli(["db", "status"], env, status1IO)).toBe(0);
    const status1 = status1IO.lines.join("\n");
    expect(status1).toContain("初期化済み");
    // tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: 新しいゲームは turn=0 (開始前)。
    // 「表記の原則」節: 「ターン 0」という数字は出さず「ゲーム開始前」と表記する。
    expect(status1).toContain("ターン: ゲーム開始前");
    expect(status1).toContain("島数: 0");

    const advanceIO = createIO();
    expect(await runCli(["turn", "advance"], env, advanceIO)).toBe(0);
    expect(advanceIO.lines.join("\n")).toContain("ターンを進めました");

    const status2IO = createIO();
    expect(await runCli(["db", "status"], env, status2IO)).toBe(0);
    expect(status2IO.lines.join("\n")).toContain("ターン: 1");

    const backupCreateIO = createIO();
    expect(await runCli(["backup", "create", "x"], env, backupCreateIO)).toBe(0);
    expect(backupCreateIO.lines.join("\n")).toContain("x");

    const backupListIO = createIO();
    expect(await runCli(["backup", "list"], env, backupListIO)).toBe(0);
    expect(backupListIO.lines.join("\n")).toContain("x");
  });

  it("turn check は期限が来ていなければ 0 ターンと表示する", async () => {
    // tmp/16-season.md「開始前の状態 = ターン 0」節: 開始日時省略時は現在時刻の切り下げになり
    // 即座に期限到来してしまうため、「期限が来ていない」状況を作るには --start-at を明示的に
    // 未来にする必要がある。
    await runCli(["db", "init", "--start-at", "2099-01-01T00:00:00Z"], env, createIO());
    const io = createIO();
    expect(await runCli(["turn", "check"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("0 ターン進めました");
  });

  it("time set は unix 秒指定で最終更新時間を変更する", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    expect(await runCli(["time", "set", "1700000000"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("1700000000");
  });

  it("time set は ISO8601 指定でも最終更新時間を変更する", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    expect(await runCli(["time", "set", "2024-01-01T00:00:00Z"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("1704067200");
  });

  it("time set に不正な値を渡すと 2 を返す", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    expect(await runCli(["time", "set", "not-a-date"], env, io)).toBe(2);
  });

  it("backup restore は存在しないラベルなら 1 を返す", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    const code = await runCli(["backup", "restore", "no-such-label"], env, io);
    expect(code).toBe(1);
    expect(io.errLines.length).toBeGreaterThan(0);
  });

  it("backup delete/restore ともにラベル省略時は 2 を返す", async () => {
    await runCli(["db", "init"], env, createIO());
    expect(await runCli(["backup", "restore"], env, createIO())).toBe(2);
    expect(await runCli(["backup", "delete"], env, createIO())).toBe(2);
  });
});

describe("cli (tmp/16-season.md: 開始時刻・最終ターン)", () => {
  let dir: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hakoniwa-cli-season-test-"));
    env = {
      HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
      HAKONIWA_BACKUP_DIR: join(dir, "backups"),
      HAKONIWA_AUTH_SECRET: "a".repeat(32),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("db init --start-at --final-turn で開始時刻と最終ターンを指定できる", async () => {
    const io = createIO();
    expect(
      await runCli(
        ["db", "init", "--start-at", "2026-10-01T21:00:00+09:00", "--final-turn", "100"],
        env,
        io,
      ),
    ).toBe(0);

    const statusIO = createIO();
    expect(await runCli(["db", "status"], env, statusIO)).toBe(0);
    const status = statusIO.lines.join("\n");
    expect(status).toContain("最終ターン: 100");
    expect(status).toContain("状態(シーズン): ゲーム開始前");
  });

  it("db init は廃止した HAKONIWA_START_AT / HAKONIWA_FINAL_TURN を読まない (省略時は無期限)", async () => {
    const envWithDeprecated = {
      ...env,
      HAKONIWA_START_AT: "2026-10-01T21:00:00+09:00",
      HAKONIWA_FINAL_TURN: "200",
    };
    expect(await runCli(["db", "init"], envWithDeprecated, createIO())).toBe(0);

    const statusIO = createIO();
    expect(await runCli(["db", "status"], envWithDeprecated, statusIO)).toBe(0);
    expect(statusIO.lines.join("\n")).toContain("最終ターン: 無期限");
  });

  it("game set-final-turn <N> で最終ターンを変更できる", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    expect(await runCli(["game", "set-final-turn", "5"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("5");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    expect(statusIO.lines.join("\n")).toContain("最終ターン: 5");
  });

  it("game set-final-turn none で無期限に戻せる", async () => {
    await runCli(["db", "init", "--final-turn", "5"], env, createIO());
    const io = createIO();
    expect(await runCli(["game", "set-final-turn", "none"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("無期限");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    expect(statusIO.lines.join("\n")).toContain("最終ターン: 無期限");
  });

  it("game set-final-turn に不正な値を渡すと 2 を返す", async () => {
    await runCli(["db", "init"], env, createIO());
    expect(await runCli(["game", "set-final-turn", "abc"], env, createIO())).toBe(2);
  });

  it("db status: 終了後は状態(シーズン)が「終了」になる", async () => {
    await runCli(["db", "init", "--final-turn", "1"], env, createIO());
    await runCli(["turn", "advance"], env, createIO());

    const io = createIO();
    await runCli(["db", "status"], env, io);
    const status = io.lines.join("\n");
    expect(status).toContain("状態(シーズン): 終了");

    // 終了後は turn advance / turn check とも進まない。
    const advanceIO = createIO();
    await runCli(["turn", "advance"], env, advanceIO);
    const statusAfterIO = createIO();
    await runCli(["db", "status"], env, statusAfterIO);
    // tmp/16-season.md「開始前の状態 = ターン 0」節: 新しいゲームは turn=0 で始まるため、
    // finalTurn=1 は最初の 1 回の処理 (turn=1) で終了する。
    expect(statusAfterIO.lines.join("\n")).toContain("ターン: 1");
  });
});

describe("cli (tmp/16-season.md: ターンの長さも DB に持つ)", () => {
  let dir: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hakoniwa-cli-unittime-test-"));
    env = {
      HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
      HAKONIWA_BACKUP_DIR: join(dir, "backups"),
      HAKONIWA_AUTH_SECRET: "a".repeat(32),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("db init --unit-time で1ターンの長さを指定できる", async () => {
    expect(await runCli(["db", "init", "--unit-time", "60"], env, createIO())).toBe(0);

    const statusIO = createIO();
    expect(await runCli(["db", "status"], env, statusIO)).toBe(0);
    expect(statusIO.lines.join("\n")).toContain("1 ターンの長さ: 1分");
  });

  it("db init は廃止した HAKONIWA_UNIT_TIME_SEC を読まない (省略時は 6 時間)", async () => {
    const envWithDeprecated = { ...env, HAKONIWA_UNIT_TIME_SEC: "3600" };
    expect(await runCli(["db", "init"], envWithDeprecated, createIO())).toBe(0);

    const statusIO = createIO();
    await runCli(["db", "status"], envWithDeprecated, statusIO);
    expect(statusIO.lines.join("\n")).toContain("1 ターンの長さ: 6時間");
  });

  it("game set-unit-time <sec> で1ターンの長さを変更できる", async () => {
    await runCli(["db", "init"], env, createIO());
    const io = createIO();
    expect(await runCli(["game", "set-unit-time", "120"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("2分");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    expect(statusIO.lines.join("\n")).toContain("1 ターンの長さ: 2分");
  });

  it("game set-unit-time に不正な値を渡すと 2 を返す", async () => {
    await runCli(["db", "init"], env, createIO());
    expect(await runCli(["game", "set-unit-time", "0"], env, createIO())).toBe(2);
    expect(await runCli(["game", "set-unit-time", "abc"], env, createIO())).toBe(2);
  });
});

describe("cli (tmp/18-games.md: game new/finish/list)", () => {
  let dir: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hakoniwa-cli-games-test-"));
    env = {
      HAKONIWA_DB_PATH: join(dir, "hakoniwa.sqlite"),
      HAKONIWA_BACKUP_DIR: join(dir, "backups"),
      HAKONIWA_AUTH_SECRET: "a".repeat(32),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("game new: ゲームが無ければ開始できる (db init と同じ効果)", async () => {
    const io = createIO();
    expect(await runCli(["game", "new"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("新しいゲームを開始しました");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    const status = statusIO.lines.join("\n");
    expect(status).toContain("初期化済み");
    expect(status).toContain("第 1 回");
    expect(status).toContain("過去のゲーム数: 0");
  });

  it("game new --name/--final-turn/--unit-time を指定できる", async () => {
    const io = createIO();
    expect(
      await runCli(
        ["game", "new", "--name", "特別編", "--final-turn", "5", "--unit-time", "1h"],
        env,
        io,
      ),
    ).toBe(0);
    expect(io.lines.join("\n")).toContain("特別編");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    const status = statusIO.lines.join("\n");
    expect(status).toContain("特別編");
    expect(status).toContain("最終ターン: 5");
    expect(status).toContain("1 ターンの長さ: 1時間");
  });

  it("game new: 現在のゲームが running のときはエラーで終了コード 1", async () => {
    await runCli(["game", "new"], env, createIO());
    const io = createIO();
    const code = await runCli(["game", "new"], env, io);
    expect(code).toBe(1);
    expect(io.errLines.length).toBeGreaterThan(0);
  });

  it("game finish: 現在のゲームを終了できる (db status の状態がすべて終了になる)", async () => {
    await runCli(["game", "new"], env, createIO());
    const io = createIO();
    expect(await runCli(["game", "finish"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("終了しました");

    const statusIO = createIO();
    await runCli(["db", "status"], env, statusIO);
    expect(statusIO.lines.join("\n")).toContain("状態(シーズン): 終了");
  });

  it("game finish: ゲームが無いときはエラーで終了コード 1", async () => {
    const io = createIO();
    const code = await runCli(["game", "finish"], env, io);
    expect(code).toBe(1);
  });

  it("game finish: 既に終了したゲームをもう一度終了しようとするとエラーで終了コード 1", async () => {
    await runCli(["game", "new"], env, createIO());
    await runCli(["game", "finish"], env, createIO());
    const io = createIO();
    const code = await runCli(["game", "finish"], env, io);
    expect(code).toBe(1);
  });

  it("game list: ゲームが無ければその旨を表示する", async () => {
    const io = createIO();
    expect(await runCli(["game", "list"], env, io)).toBe(0);
    expect(io.lines.join("\n")).toContain("ゲームはありません");
  });

  it("game list: 現在 + 過去のゲームを一覧表示する", async () => {
    await runCli(["game", "new", "--name", "第 1 回"], env, createIO());
    await runCli(["game", "finish"], env, createIO());
    await runCli(["game", "new", "--name", "第 2 回"], env, createIO());

    const io = createIO();
    expect(await runCli(["game", "list"], env, io)).toBe(0);
    const output = io.lines.join("\n");
    expect(output).toContain("第 1 回");
    expect(output).toContain("第 2 回");
    expect(output).toContain("(現在)");
  });

  it("db init はゲームが無いときだけ game new として働く (既にゲームがあれば失敗)", async () => {
    expect(await runCli(["db", "init"], env, createIO())).toBe(0);
    const io = createIO();
    expect(await runCli(["db", "init"], env, io)).toBe(1);
  });
});
