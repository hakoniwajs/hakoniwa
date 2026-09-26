// tmp/04-database.md 「スキーマ適用 (migrate.ts)」節 + tmp/14-users-auth.md
// 「スキーマは v2 として作り直す (v1 からの移行は提供しない)」+ tmp/16-season.md
// 「migrate を『現在の version から順にステップを適用』する形にする」+ tmp/18-games.md
// 「v4 → v5 のステップ」の移植。
import type { SqlDriver } from "./driver.ts";
import { SCHEMA_VERSION, schemaSql } from "./schema.ts";

/** `migrate` の追加オプション。tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。 */
export interface MigrateOptions {
  /**
   * v3 → v4 のステップで既存行の `unit_time_sec` をバックフィルする値。
   * 省略時は 21600 (6 時間。`defaultConfig.unitTimeSec` と同じ)。Adapter は
   * `config.unitTimeSec` (既定 21600) を渡す。
   */
  defaultUnitTimeSec?: number;
}

/**
 * version N → N+1 のマイグレーションステップ。1 トランザクションで適用され、
 * 適用後に `schema_version` が自動的に N+1 へ更新される (ステップ内で更新する必要はない)。
 */
type MigrationStep = (driver: SqlDriver, opts: Required<MigrateOptions>) => void;

interface V4GameRow {
  turn: number;
  last_time: number;
  next_island_id: number;
  final_turn: number | null;
  start_at: number;
  unit_time_sec: number;
}

/**
 * 表の有無を確認する。v4 → v5 ステップで `islands`/`lbbs_posts`/`logs`/`history` を
 * 移行する前に使う。本来これらの表は v1 のスキーマから常に存在するはずだが、
 * (テストのような) 最小限の DB スナップショットに対しても安全に動くよう、
 * 表が無ければ移行をスキップして v5 の空の形で作り直す (設計書との差異: 頑健性のための追加)。
 */
function tableExists(driver: SqlDriver, name: string): boolean {
  return (
    driver.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name) !==
    undefined
  );
}

const MIGRATION_STEPS: Record<number, MigrationStep> = {
  // v2 → v3: tmp/16-season.md。最終ターンと開始時刻の列を追加する (`db reset` を要求しない)。
  // start_at は既存データに historical な値が無いため、既存の last_time で近似する
  // (これまでのゲームは season 機能が無く、常に turn=1 で始まっているとは限らないため厳密な
  // 復元はできない。表示上の近似値として割り切る)。
  2: (driver) => {
    driver.exec("ALTER TABLE game ADD COLUMN final_turn INTEGER");
    driver.exec("ALTER TABLE game ADD COLUMN start_at INTEGER NOT NULL DEFAULT 0");
    driver.exec("UPDATE game SET start_at = last_time");
  },
  // v3 → v4: tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。
  // SQLite の ADD COLUMN は NOT NULL 列に DEFAULT が必須で、かつプレースホルダを使えないため、
  // 検証済みの整数をリテラルとして文字列連結で埋め込む。
  3: (driver, opts) => {
    driver.exec(
      `ALTER TABLE game ADD COLUMN unit_time_sec INTEGER NOT NULL DEFAULT ${opts.defaultUnitTimeSec}`,
    );
  },
  // v4 → v5: tmp/18-games.md「データ (スキーマ v5)」節。
  // `game` (単一行) を `games` (id=1、name='第 1 回') に複製して廃止し、`islands` の主キーを
  // (game_id, id) に作り直す。`lbbs_posts` は設計書は ADD COLUMN のみを指示しているが、
  // 主キーに game_id を含めないと将来ゲームを増やしたときに island_id の再利用で衝突するため
  // (schema.ts のコメント参照)、islands と同様に表を作り直す (設計書との差異)。
  // `logs`/`history` は設計書どおり ADD COLUMN + game_id を含むインデックスの張り直し。
  4: (driver) => {
    driver.exec(`
      CREATE TABLE games (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        status          TEXT    NOT NULL CHECK (status IN ('running', 'finished')),
        turn            INTEGER NOT NULL,
        last_time       INTEGER NOT NULL,
        start_at        INTEGER NOT NULL,
        final_turn      INTEGER,
        unit_time_sec   INTEGER NOT NULL,
        next_island_id  INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        finished_at     INTEGER
      ) STRICT;
    `);

    const game = driver.get<V4GameRow>(
      "SELECT turn, last_time, next_island_id, final_turn, start_at, unit_time_sec FROM game WHERE id = 1",
    );
    if (game !== undefined) {
      const finished = game.final_turn !== null && game.turn > game.final_turn;
      driver.run(
        `INSERT INTO games (
           id, name, status, turn, last_time, start_at, final_turn, unit_time_sec,
           next_island_id, created_at, finished_at
         ) VALUES (1, '第 1 回', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        finished ? "finished" : "running",
        game.turn,
        game.last_time,
        game.start_at,
        game.final_turn,
        game.unit_time_sec,
        game.next_island_id,
        game.start_at,
        finished ? game.last_time : null,
      );
    }
    driver.exec("DROP TABLE game");

    const hadIslands = tableExists(driver, "islands");
    const hadLbbsPosts = tableExists(driver, "lbbs_posts");
    const hadLogs = tableExists(driver, "logs");
    const hadHistory = tableExists(driver, "history");

    // islands: (game_id, id) 主キーへ作り直す。新表作成 → INSERT SELECT (表があれば) → DROP → RENAME。
    driver.exec(`
      CREATE TABLE islands_v5 (
        game_id         INTEGER NOT NULL,
        id              INTEGER NOT NULL,
        rank            INTEGER NOT NULL,
        name            TEXT    NOT NULL,
        owner_user_id   TEXT    NOT NULL,
        comment         TEXT    NOT NULL DEFAULT '',
        score           INTEGER NOT NULL DEFAULT 0,
        absent          INTEGER NOT NULL DEFAULT 0,
        money           INTEGER NOT NULL,
        food            INTEGER NOT NULL,
        pop             INTEGER NOT NULL DEFAULT 0,
        area            INTEGER NOT NULL DEFAULT 0,
        farm            INTEGER NOT NULL DEFAULT 0,
        factory         INTEGER NOT NULL DEFAULT 0,
        mountain        INTEGER NOT NULL DEFAULT 0,
        prize_flags     INTEGER NOT NULL DEFAULT 0,
        prize_monsters  INTEGER NOT NULL DEFAULT 0,
        prize_turns     TEXT    NOT NULL DEFAULT '[]',
        terrain         TEXT    NOT NULL,
        commands        TEXT    NOT NULL,
        created_turn    INTEGER NOT NULL,
        PRIMARY KEY (game_id, id)
      ) STRICT;
    `);
    if (hadIslands) {
      driver.exec(`
        INSERT INTO islands_v5 (
          game_id, id, rank, name, owner_user_id, comment, score, absent, money, food,
          pop, area, farm, factory, mountain, prize_flags, prize_monsters, prize_turns,
          terrain, commands, created_turn
        )
        SELECT 1, id, rank, name, owner_user_id, comment, score, absent, money, food,
          pop, area, farm, factory, mountain, prize_flags, prize_monsters, prize_turns,
          terrain, commands, created_turn
        FROM islands;
      `);
      driver.exec("DROP TABLE islands");
    }
    driver.exec("ALTER TABLE islands_v5 RENAME TO islands");
    driver.exec("CREATE UNIQUE INDEX islands_game_rank ON islands(game_id, rank)");
    driver.exec("CREATE UNIQUE INDEX islands_game_name ON islands(game_id, name)");
    driver.exec("CREATE UNIQUE INDEX islands_game_owner ON islands(game_id, owner_user_id)");

    // lbbs_posts: (game_id, island_id, position) 主キーへ作り直す。
    driver.exec(`
      CREATE TABLE lbbs_posts_v5 (
        game_id     INTEGER NOT NULL DEFAULT 1,
        island_id   INTEGER NOT NULL,
        position    INTEGER NOT NULL,
        author      TEXT    NOT NULL CHECK (author IN ('visitor', 'owner')),
        user_id     TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        message     TEXT    NOT NULL,
        turn        INTEGER NOT NULL,
        PRIMARY KEY (game_id, island_id, position)
      ) STRICT;
    `);
    if (hadLbbsPosts) {
      driver.exec(`
        INSERT INTO lbbs_posts_v5 (game_id, island_id, position, author, user_id, name, message, turn)
        SELECT 1, island_id, position, author, user_id, name, message, turn FROM lbbs_posts;
      `);
      driver.exec("DROP TABLE lbbs_posts");
    }
    driver.exec("ALTER TABLE lbbs_posts_v5 RENAME TO lbbs_posts");

    // logs / history: 設計書どおり ADD COLUMN + game_id を含む索引の張り直し
    // (表が無ければ v5 の形で作り直す)。
    if (hadLogs) {
      driver.exec("ALTER TABLE logs ADD COLUMN game_id INTEGER NOT NULL DEFAULT 1");
      driver.exec("DROP INDEX IF EXISTS logs_turn_seq");
      driver.exec("DROP INDEX IF EXISTS logs_island");
      driver.exec("DROP INDEX IF EXISTS logs_target");
    } else {
      driver.exec(`
        CREATE TABLE logs (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id     INTEGER NOT NULL DEFAULT 1,
          turn        INTEGER NOT NULL,
          seq         INTEGER NOT NULL,
          secret      INTEGER NOT NULL DEFAULT 0,
          island_id   INTEGER NOT NULL DEFAULT 0,
          target_id   INTEGER NOT NULL DEFAULT 0,
          html        TEXT    NOT NULL
        ) STRICT;
      `);
    }
    driver.exec("CREATE INDEX logs_game_turn_seq ON logs(game_id, turn, seq)");
    driver.exec("CREATE INDEX logs_game_island ON logs(game_id, island_id, turn)");
    driver.exec("CREATE INDEX logs_game_target ON logs(game_id, target_id, turn)");

    if (hadHistory) {
      driver.exec("ALTER TABLE history ADD COLUMN game_id INTEGER NOT NULL DEFAULT 1");
    } else {
      driver.exec(`
        CREATE TABLE history (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL DEFAULT 1,
          turn    INTEGER NOT NULL,
          html    TEXT    NOT NULL
        ) STRICT;
      `);
    }
    driver.exec("CREATE INDEX history_game ON history(game_id, id)");
  },

  // v5 → v6: tmp/19-abandon.md「データ (スキーマ v6)」節。
  // islands.abandoned_at (NULL = 有効) を追加し、所有の一意性を「放棄されていない島だけ」に
  // 絞った部分インデックスへ差し替える (現行の一意性は UNIQUE INDEX (table 制約ではない) なので
  // DROP INDEX → CREATE INDEX で済み、islands 表そのものの作り直しは不要)。放棄回数を記録する
  // abandonments 表を追加する。
  5: (driver) => {
    driver.exec("ALTER TABLE islands ADD COLUMN abandoned_at INTEGER");
    driver.exec("DROP INDEX IF EXISTS islands_game_owner");
    driver.exec(
      "CREATE UNIQUE INDEX islands_owner_active ON islands(game_id, owner_user_id) WHERE abandoned_at IS NULL",
    );
    driver.exec(`
      CREATE TABLE abandonments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id      INTEGER NOT NULL,
        user_id      TEXT    NOT NULL,
        island_id    INTEGER NOT NULL,
        island_name  TEXT    NOT NULL,
        abandoned_at INTEGER NOT NULL
      ) STRICT;
    `);
    driver.exec("CREATE INDEX abandonments_game_user ON abandonments(game_id, user_id)");
  },

  // v6 → v7: tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節。
  // 「今動いているゲームはこのままにしたい」(ユーザー指示) ため、既に 1 ターン以上処理された
  // ゲームは番号・ログ・終了時刻を一切変えない (first_turn=1 の旧方式のまま)。まだ 1 回も
  // 処理していない running なゲーム (turn=1) だけを turn=0/first_turn=0 の新方式に変換する
  // (lastTime は createGame 時点で startAt と同じ値のはずなのでそのまま。既に now >= startAt
  // なら次のトリガーで即ターン1が処理される)。
  6: (driver) => {
    driver.exec("ALTER TABLE games ADD COLUMN first_turn INTEGER NOT NULL DEFAULT 1");
    driver.exec("UPDATE games SET turn = 0, first_turn = 0 WHERE turn = 1 AND status = 'running'");
  },

  // v7 → v8: tmp/20-autoprepare-fix.md「修正 (稼働中ゲームのデータ、スキーマ v8。ユーザー指示に
  // より実施)」節。DDL の変更は無い (データ変換のみ)。`GameService.registerCommand` のバグにより
  // 「整地自動入力」「地ならし自動入力」の計画が、本来書き込むべき実コマンド (整地 = kind 1 /
  // 地ならし = kind 2) ではなく、入力値の kind (AutoPrepare = 61 / AutoPrepare2 = 62) のまま
  // `islands.commands` に保存されてしまっていた。`islands.commands` は `Command[]` を
  // `JSON.stringify` した文字列なので、SQL の文字列置換ではなく `driver.all` で全行読み、
  // `JSON.parse` → 該当 kind だけ変換 → `JSON.stringify` で書き戻す (保存形式に依存しないため)。
  // target/x/y/arg と他の計画の kind は一切変更しない。対象は終了済み・放棄済みの島も含めて全件。
  // 変換対象の計画が 1 つも無い島は UPDATE しない。
  7: (driver) => {
    const rows = driver.all<{ game_id: number; id: number; commands: string }>(
      "SELECT game_id, id, commands FROM islands",
    );
    for (const row of rows) {
      const commands = JSON.parse(row.commands) as Array<{ kind: number; [key: string]: unknown }>;
      let changed = false;
      for (const command of commands) {
        if (command.kind === 61) {
          command.kind = 1;
          changed = true;
        } else if (command.kind === 62) {
          command.kind = 2;
          changed = true;
        }
      }
      if (!changed) continue;
      driver.run(
        "UPDATE islands SET commands = ? WHERE game_id = ? AND id = ?",
        JSON.stringify(commands),
        row.game_id,
        row.id,
      );
    }
  },
};

/**
 * `schema_version` 表の有無を `sqlite_master` で確認する。
 * - 無ければ空 DB とみなし、DDL 全体 (現行の `SCHEMA_VERSION` 相当) を 1 トランザクションで適用し、
 *   `schema_version` に `SCHEMA_VERSION` を INSERT する。
 * - v1 (パスワード認証時代のスキーマ) を検出した場合は自動移行せず、明確な Error を throw する
 *   (`db reset` を促す)。
 * - v2 以降であれば、現在の version から `SCHEMA_VERSION` まで `MIGRATION_STEPS` を順に適用する
 *   (各ステップは 1 トランザクション)。既に最新なら何もしない。
 *
 * DO では constructor の `blockConcurrencyWhile` 内で呼ぶことを想定 (12-workers-adapter.md)。
 */
export function migrate(driver: SqlDriver, opts: MigrateOptions = {}): void {
  const defaultUnitTimeSec = opts.defaultUnitTimeSec ?? 21600;
  if (!Number.isSafeInteger(defaultUnitTimeSec) || defaultUnitTimeSec <= 0) {
    throw new Error(
      `migrate: defaultUnitTimeSec must be a positive integer (got: ${defaultUnitTimeSec})`,
    );
  }
  const stepOpts: Required<MigrateOptions> = { defaultUnitTimeSec };
  const existing = driver.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  );
  if (existing === undefined) {
    driver.transaction(() => {
      driver.exec(schemaSql);
      driver.run("INSERT INTO schema_version (version) VALUES (?)", SCHEMA_VERSION);
    });
    return;
  }

  const row = driver.get<{ version: number }>("SELECT version FROM schema_version LIMIT 1");
  let version = row?.version ?? 0;

  if (version === 1) {
    throw new Error(
      `migrate: incompatible schema version ${version} (expected ${SCHEMA_VERSION}). ` +
        "v1 (パスワード認証) のデータベースは自動移行できません。" +
        "`db reset` を実行してデータベースを作り直してください。",
    );
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATION_STEPS[version];
    if (step === undefined) {
      throw new Error(
        `migrate: incompatible schema version ${version} (expected ${SCHEMA_VERSION}). ` +
          "このバージョンからの移行ステップが定義されていません。" +
          "`db reset` を実行してデータベースを作り直してください。",
      );
    }
    const next = version + 1;
    driver.transaction(() => {
      step(driver, stepOpts);
      driver.run("UPDATE schema_version SET version = ?", next);
    });
    version = next;
  }
}
