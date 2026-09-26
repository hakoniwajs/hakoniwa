#!/usr/bin/env node
// tmp/08-turn-trigger-admin-cli.md 「CLI」節の移植。
// Perl 版 Maintenance.pm の各モードを CLI から叩けるようにする。
// `node dist/cli.js <command>` または root で `vp run --filter ./packages/node cli -- <command>`。
import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  formatDateTime,
  formatDuration,
  GAME_NOT_STARTED_LABEL,
  parseDuration,
} from "@hakoniwajs/core";
import type { GameStatus, SeasonState } from "@hakoniwajs/core";
import { composeNode } from "./compose.ts";
import type { ComposedNode } from "./compose.ts";
import { loadNodeConfig } from "./config.ts";
import { startServer } from "./serve.ts";

/** テストから差し込める最小限の出力口。既定は console。 */
export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIO: CliIO = {
  // eslint 的には console 直呼びだが、CLI エントリポイントなので許容する。
  stdout: (line: string) => {
    console.log(line);
  },
  stderr: (line: string) => {
    console.error(line);
  },
};

/** 使い方に反する呼び出し (未知のコマンド、引数不足等)。終了コード 2。 */
class UsageError extends Error {}

const HELP_TEXT = `hakoniwa CLI

使い方: hakoniwa <command> [options]

コマンド:
  db init                ゲームが無いときだけ新しいゲームを開始する (game new のエイリアス。
                          既にゲームがあれば running/finished を問わず失敗する)
    --start-at <ISO8601>    ターン 1 の処理が実行される時刻 (ゲーム開始。
                             省略時: 現在時刻を切り下げ)
    --final-turn <N>        最終ターン数 (省略時: 無期限)
    --unit-time <値>        1 ターンの長さ (省略時: 6h。
                             "6h"/"90m"/"1h30m"/"3600" (数字のみは秒) を受け付ける)
  db reset --yes         現役データを削除する (要 --yes)
                          ※ v1 (パスワード認証) の DB は v2 (better-auth) のスキーマと
                            互換性が無いため、v1 の DB ファイルを使い続けている場合は
                            このコマンドで一度リセットしてから db init してください。
  db status              現役データの状態を表示する (開始時刻・最終ターン・1 ターンの長さ・状態を含む)
  turn check             期限が来ていればターンを進める (終了後は 0)
  turn advance           期限に関係なく強制的に 1 ターン進める (終了後は何もしない)
  time set <unix|ISO8601> 最終更新時間を変更する
  game new               新しいゲームを開始する (現在のゲームが running なら失敗、終了コード 1)
    --name <名前>            省略時「第 N 回」
    --start-at <ISO8601>     ターン 1 の処理が実行される時刻 (ゲーム開始。省略時: 現在時刻を切り下げ)
    --final-turn <N>         省略時: 無期限
    --unit-time <値>         省略時: 6h。
                             "6h"/"90m"/"1h30m"/"3600" (数字のみは秒) を受け付ける
  game finish             現在のゲームを終了する (running でなければ失敗、終了コード 1)
  game list               ゲーム一覧 (現在 + 過去) を表示する
  game set-final-turn <N|none> 現在のゲームの最終ターン数を変更する (none で無期限に戻す)
  game set-unit-time <値> 現在のゲームの1 ターンの長さを変更する (次のターン境界から効く。
                          "6h"/"90m"/"1h30m"/"3600" (数字のみは秒) を受け付ける)
  backup list            バックアップ一覧を表示する
  backup create [label]  バックアップを作成する (label 省略可)
  backup restore <label> バックアップを現役データへ復元する
  backup delete <label>  バックアップを削除する
  serve                  HTTP サーバーを起動する (Ctrl+C / SIGTERM で停止)

  -h, --help             このヘルプを表示する

環境変数は @hakoniwajs/core の loadConfigFromEnv と config.ts (HAKONIWA_DB_PATH 等) を参照する。
`;

const SEASON_STATE_LABELS: Record<SeasonState, string> = {
  before: GAME_NOT_STARTED_LABEL,
  running: "進行中",
  finished: "終了",
};

/** 正の整数文字列を検証して数値に変換する。`game set-final-turn`/`db init --final-turn` 共通。 */
function parsePositiveIntArg(raw: string, label: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new UsageError(`${label} は正の整数で指定してください (got: ${raw})`);
  }
  return Number(raw);
}

/**
 * 1 ターンの長さの文字列 (`"6h"`/`"90m"`/`"1h30m"`/`"3600"` (数字のみは秒)) を秒数に変換する。
 * `db init --unit-time`/`game set-unit-time` 共通。「1 ターンの長さの入力を『時間・分』にする」節。
 */
function parseDurationArg(raw: string, label: string): number {
  const sec = parseDuration(raw);
  if (sec === undefined) {
    throw new UsageError(
      `${label} は "6h"/"90m"/"1h30m"/"3600" (数字のみは秒) の形式で指定してください (got: ${raw})`,
    );
  }
  return sec;
}

/** unix 秒 (整数文字列) または ISO8601 文字列を unix 秒に変換する。 */
function parseUnixOrIso8601(raw: string): number {
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new UsageError(`time set: unix 秒または ISO8601 形式で指定してください (got: ${raw})`);
  }
  return Math.floor(ms / 1000);
}

function requirePositional(positionals: string[], index: number, label: string): string {
  const value = positionals[index];
  if (value === undefined) {
    throw new UsageError(`${label} が指定されていません。`);
  }
  return value;
}

function formatTimestamp(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString()} (${unixSeconds})`;
}

async function runDb(
  positionals: string[],
  values: { yes?: boolean; "start-at"?: string; "final-turn"?: string; "unit-time"?: string },
  node: ComposedNode,
  io: CliIO,
): Promise<void> {
  const sub = requirePositional(positionals, 0, "db サブコマンド");
  switch (sub) {
    case "init": {
      const startAtRaw = values["start-at"];
      const startAt = startAtRaw !== undefined ? parseUnixOrIso8601(startAtRaw) : undefined;
      const finalTurnRaw = values["final-turn"];
      const finalTurn =
        finalTurnRaw !== undefined ? parsePositiveIntArg(finalTurnRaw, "--final-turn") : undefined;
      const unitTimeSecRaw = values["unit-time"];
      const unitTimeSec =
        unitTimeSecRaw !== undefined ? parseDurationArg(unitTimeSecRaw, "--unit-time") : undefined;
      node.adminService.initialize(Math.floor(Date.now() / 1000), {
        ...(startAt !== undefined ? { startAt } : {}),
        ...(finalTurn !== undefined ? { finalTurn } : {}),
        ...(unitTimeSec !== undefined ? { unitTimeSec } : {}),
      });
      io.stdout("新しいデータを作成しました。");
      return;
    }
    case "reset": {
      if (values.yes !== true) {
        throw new UsageError(
          "db reset は --yes を付けて実行してください (現役データを削除します)。",
        );
      }
      node.adminService.reset();
      io.stdout("現役データを削除しました。");
      return;
    }
    case "status": {
      const status = await node.adminService.status();
      if (!status.initialized) {
        io.stdout("状態: 未初期化");
      } else {
        const islandCount =
          status.gameId !== undefined ? node.repo.listIslandSummaries(status.gameId).length : 0;
        io.stdout(`状態: 初期化済み`);
        io.stdout(`ゲーム: ${status.gameName} (id=${status.gameId}, ${status.gameStatus})`);
        io.stdout(`ターン: ${status.turn === 0 ? GAME_NOT_STARTED_LABEL : status.turn}`);
        io.stdout(`最終更新時間: ${formatTimestamp(status.lastTime ?? 0)}`);
        io.stdout(`島数: ${islandCount}`);
        if (status.season !== undefined) {
          const { timezone } = node.siteSettings.get();
          io.stdout(`開始時刻: ${formatDateTime(status.season.startAt, timezone)} (${timezone})`);
          io.stdout(`最終ターン: ${status.season.finalTurn ?? "無期限"}`);
          io.stdout(`1 ターンの長さ: ${formatDuration(status.season.unitTimeSec)}`);
          io.stdout(`状態(シーズン): ${SEASON_STATE_LABELS[status.season.state]}`);
        }
        // tmp/18-games.md「CLI」節: db status は現在のゲームを表示する。過去のゲーム数も併せて表示する。
        const pastGameCount = status.games.filter((g) => g.id !== status.gameId).length;
        io.stdout(`過去のゲーム数: ${pastGameCount}`);
      }
      io.stdout(`バックアップ数: ${status.backups.length}`);
      for (const backup of status.backups) {
        io.stdout(
          `  - ${backup.label} (turn=${backup.turn}, createdAt=${formatTimestamp(backup.createdAt)})`,
        );
      }
      return;
    }
    default:
      throw new UsageError(`db: 未知のサブコマンドです: ${sub}`);
  }
}

async function runTurn(positionals: string[], node: ComposedNode, io: CliIO): Promise<void> {
  const sub = requirePositional(positionals, 0, "turn サブコマンド");
  const now = Math.floor(Date.now() / 1000);
  switch (sub) {
    case "check": {
      const count = node.turnService.advanceTurnIfDue(now);
      io.stdout(`${count} ターン進めました。`);
      return;
    }
    case "advance": {
      node.adminService.advanceTurn(now);
      io.stdout("ターンを進めました。");
      return;
    }
    default:
      throw new UsageError(`turn: 未知のサブコマンドです: ${sub}`);
  }
}

async function runTime(positionals: string[], node: ComposedNode, io: CliIO): Promise<void> {
  const sub = requirePositional(positionals, 0, "time サブコマンド");
  switch (sub) {
    case "set": {
      const raw = requirePositional(positionals, 1, "time set の日時");
      const unix = parseUnixOrIso8601(raw);
      node.adminService.setLastTime(unix);
      io.stdout(`最終更新時間を ${formatTimestamp(unix)} に変更しました。`);
      return;
    }
    default:
      throw new UsageError(`time: 未知のサブコマンドです: ${sub}`);
  }
}

const GAME_STATUS_LABELS: Record<GameStatus, string> = { running: "進行中", finished: "終了" };

async function runGame(
  positionals: string[],
  values: { name?: string; "start-at"?: string; "final-turn"?: string; "unit-time"?: string },
  node: ComposedNode,
  io: CliIO,
): Promise<void> {
  const sub = requirePositional(positionals, 0, "game サブコマンド");
  switch (sub) {
    // tmp/18-games.md「CLI」節: 現在のゲームが running のときはエラー (AdminService.startGame が
    // AppError('game_running') を throw し、runCli の catch で終了コード 1 になる)。
    case "new": {
      const startAtRaw = values["start-at"];
      const finalTurnRaw = values["final-turn"];
      const unitTimeSecRaw = values["unit-time"];
      const newId = node.adminService.startGame(
        {
          ...(values.name !== undefined ? { name: values.name } : {}),
          ...(startAtRaw !== undefined ? { startAt: parseUnixOrIso8601(startAtRaw) } : {}),
          ...(finalTurnRaw !== undefined
            ? { finalTurn: parsePositiveIntArg(finalTurnRaw, "--final-turn") }
            : {}),
          ...(unitTimeSecRaw !== undefined
            ? { unitTimeSec: parseDurationArg(unitTimeSecRaw, "--unit-time") }
            : {}),
        },
        Math.floor(Date.now() / 1000),
      );
      const meta = node.repo.getMeta(newId);
      io.stdout(`新しいゲームを開始しました。(id=${newId}, name=${meta.name})`);
      return;
    }
    case "finish": {
      node.adminService.finishCurrentGame(Math.floor(Date.now() / 1000));
      io.stdout("現在のゲームを終了しました。");
      return;
    }
    case "list": {
      const games = node.adminService.listGames();
      if (games.length === 0) {
        io.stdout("ゲームはありません。");
        return;
      }
      const currentId = node.repo.getCurrentGameId();
      for (const game of games) {
        const marker = game.id === currentId ? " (現在)" : "";
        io.stdout(
          `${game.id}\t${game.name}\t${GAME_STATUS_LABELS[game.status]}${marker}\t` +
            `turn=${game.turn}\tislands=${game.islandCount}\tstartAt=${formatTimestamp(game.startAt)}`,
        );
      }
      return;
    }
    case "set-final-turn": {
      const raw = requirePositional(positionals, 1, "game set-final-turn の値 (N または none)");
      const finalTurn = raw === "none" ? null : parsePositiveIntArg(raw, "game set-final-turn");
      node.adminService.setFinalTurn(finalTurn);
      io.stdout(
        finalTurn === null
          ? "最終ターンを無期限にしました。"
          : `最終ターンを ${finalTurn} に設定しました。`,
      );
      return;
    }
    case "set-unit-time": {
      const raw = requirePositional(
        positionals,
        1,
        'game set-unit-time の値 ("6h"/"90m"/"1h30m"/"3600" (数字のみは秒))',
      );
      const unitTimeSec = parseDurationArg(raw, "game set-unit-time");
      node.adminService.setUnitTimeSec(unitTimeSec);
      io.stdout(
        `1 ターンの長さを ${formatDuration(unitTimeSec)} (${unitTimeSec}秒) に設定しました。`,
      );
      return;
    }
    default:
      throw new UsageError(`game: 未知のサブコマンドです: ${sub}`);
  }
}

async function runBackup(positionals: string[], node: ComposedNode, io: CliIO): Promise<void> {
  const sub = requirePositional(positionals, 0, "backup サブコマンド");
  switch (sub) {
    case "list": {
      const backups = await node.adminService.listBackups();
      if (backups.length === 0) {
        io.stdout("バックアップはありません。");
        return;
      }
      for (const backup of backups) {
        io.stdout(
          `${backup.label}\tturn=${backup.turn}\tcreatedAt=${formatTimestamp(backup.createdAt)}`,
        );
      }
      return;
    }
    case "create": {
      const label = positionals[1];
      await node.adminService.createBackup(label);
      io.stdout(`バックアップを作成しました。${label !== undefined ? `(${label})` : ""}`);
      return;
    }
    case "restore": {
      const label = requirePositional(positionals, 1, "backup restore のラベル");
      await node.adminService.restoreBackup(label);
      io.stdout(`バックアップ ${label} を現役データへ復元しました。`);
      return;
    }
    case "delete": {
      const label = requirePositional(positionals, 1, "backup delete のラベル");
      await node.adminService.deleteBackup(label);
      io.stdout(`バックアップ ${label} を削除しました。`);
      return;
    }
    default:
      throw new UsageError(`backup: 未知のサブコマンドです: ${sub}`);
  }
}

/**
 * CLI 本体。テストからは `dist/cli.js` を子プロセスで叩くのではなく、この関数を直接呼ぶ。
 * 戻り値は終了コード (成功 0、使い方誤り 2、失敗 1)。
 */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  io: CliIO = defaultIO,
): Promise<number> {
  let values: {
    help?: boolean;
    yes?: boolean;
    name?: string;
    "start-at"?: string;
    "final-turn"?: string;
    "unit-time"?: string;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        yes: { type: "boolean" },
        name: { type: "string" },
        "start-at": { type: "string" },
        "final-turn": { type: "string" },
        "unit-time": { type: "string" },
      },
      allowPositionals: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    io.stderr(HELP_TEXT);
    return 2;
  }

  if (values.help === true) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  const command = positionals[0];
  if (command === undefined) {
    io.stderr(HELP_TEXT);
    return 2;
  }

  const rest = positionals.slice(1);

  // serve は DB を開かずプロセスを持続させるため、通常コマンドの compose/close と分ける。
  if (command === "serve") {
    startServer(loadNodeConfig(env));
    // サーバーが生きている間この Promise は解決しない (シグナルハンドラが process.exit する)。
    return new Promise<number>(() => {});
  }

  let node: ComposedNode | undefined;
  try {
    const config = loadNodeConfig(env);
    node = composeNode(config);

    switch (command) {
      case "db":
        await runDb(rest, values, node, io);
        break;
      case "turn":
        await runTurn(rest, node, io);
        break;
      case "time":
        await runTime(rest, node, io);
        break;
      case "game":
        await runGame(rest, values, node, io);
        break;
      case "backup":
        await runBackup(rest, node, io);
        break;
      default:
        throw new UsageError(`未知のコマンドです: ${command}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(err.message);
      return 2;
    }
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    node?.driver.close();
  }
}

// `node dist/cli.js ...` として直接実行された場合のみエントリポイントとして動く。
// テストからの import では実行されない (import.meta.url とエントリスクリプトの比較)。
// npm の .bin はシンボリックリンクなので、argv[1] を realpath してから比較する。
const isMain = (() => {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
