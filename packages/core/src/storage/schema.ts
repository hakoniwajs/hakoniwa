// tmp/04-database.md 「スキーマ」節 + tmp/14-users-auth.md 「データモデル」節 (v2) +
// tmp/18-games.md 「データ (スキーマ v5)」節の DDL。
// schema.sql と schema.ts の二重管理を避けるため、DDL は本ファイルの文字列だけを正とする
// (Vite の `?raw` import は Workers/テストで扱いが揺れるため使わない)。
//
// better-auth の "user"/session/account/verification の列は node_modules/better-auth
// (実体は @better-auth/core) の getAuthTables (get-tables.ts) の既定スキーマと照合した実際の
// 列に合わせている (下記コメントを参照)。

/**
 * このファイルが適用するスキーマのバージョン。v1 (パスワード認証) からの自動移行は提供しない。
 * v3: tmp/16-season.md。`game.final_turn` (最終ターン、NULL 可) を追加した。
 * v4: tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。`game.unit_time_sec` を追加した。
 * v5: tmp/18-games.md。`game` (単一行) を廃止し `games` (複数ゲーム) に置き換えた。`islands` の
 *     主キーを `(game_id, id)` に変更し、`lbbs_posts`/`logs`/`history` に `game_id` を追加した。
 * v6: tmp/19-abandon.md (島の放棄)。`islands.abandoned_at` を追加し、所有の一意性を
 *     「放棄されていない島だけ」に絞った部分インデックスに変更した。放棄回数を記録する
 *     `abandonments` 表を追加した。
 * v7: tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節。`games.first_turn` を
 *     追加した。ゲーム開始直後のターン番号 (新方式 = 0、旧方式 = 1)。新規ゲームは
 *     `turn = 0, first_turn = 0` で作られ、開始時刻に最初のターン処理が行われて `turn = 1` になる。
 * v8: tmp/20-autoprepare-fix.md「修正 (稼働中ゲームのデータ、スキーマ v8。ユーザー指示により実施)」節。
 *     DDL 自体に変更は無い (データ変換のみ)。`islands.commands` に誤って保存された
 *     `kind = 61` (AutoPrepare) / `62` (AutoPrepare2) の計画を、本来書き込むべきだった
 *     `1` (Prepare/整地) / `2` (Prepare2/地ならし) に変換する。
 */
export const SCHEMA_VERSION = 8;

export const schemaSql = `
CREATE TABLE schema_version (
  version INTEGER NOT NULL
) STRICT;

-- Perl: hakojima.dat 先頭 4 行の複数ゲーム版。tmp/18-games.md「データ (スキーマ v5)」。
-- 現在のゲームは MAX(id) の行。ゲームが終了したら status='finished' になり、次のゲームを開始できる。
-- v7: first_turn (tmp/16-season.md「開始前の状態 = ターン 0」節)。ゲーム開始直後のターン番号
-- (新方式 = 0、旧方式 = 1)。実行済みの処理回数は turn - first_turn。
CREATE TABLE games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status IN ('running', 'finished')),
  turn            INTEGER NOT NULL,
  first_turn      INTEGER NOT NULL,
  last_time       INTEGER NOT NULL,
  start_at        INTEGER NOT NULL,
  final_turn      INTEGER,
  unit_time_sec   INTEGER NOT NULL,
  next_island_id  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
) STRICT;

-- Perl: hakojima.dat の島ブロック + island.N
-- v2: password_hash を削除し、owner_user_id (better-auth "user".id, 1 ユーザー 1 島) を追加。
-- v5: 主キーを (game_id, id) に変更 (島 ID はゲーム内で 1 から採番)。tmp/18-games.md。
-- v6: abandoned_at (NULL = 有効) を追加。tmp/19-abandon.md。
CREATE TABLE islands (
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
  abandoned_at    INTEGER,
  PRIMARY KEY (game_id, id)
) STRICT;
CREATE UNIQUE INDEX islands_game_rank  ON islands(game_id, rank);
CREATE UNIQUE INDEX islands_game_name  ON islands(game_id, name);
-- v6: 所有の一意性は放棄されていない島だけに適用する (tmp/19-abandon.md「データ (スキーマ v6)」節)。
CREATE UNIQUE INDEX islands_owner_active ON islands(game_id, owner_user_id) WHERE abandoned_at IS NULL;

-- Perl 版には無い新規機能 (tmp/19-abandon.md)。島の放棄回数の記録。放棄島がターン末に削除
-- されても記録は残す (削除しない)。
CREATE TABLE abandonments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL,
  user_id      TEXT    NOT NULL,
  island_id    INTEGER NOT NULL,
  island_name  TEXT    NOT NULL,
  abandoned_at INTEGER NOT NULL
) STRICT;
CREATE INDEX abandonments_game_user ON abandonments(game_id, user_id);

-- Perl: island.N 末尾の lbbs 行。position 0 が最新
-- 外部キーは張らない (DO の PRAGMA 制限を避け、削除はリポジトリが明示的に行う)
-- v2: user_id (投稿者の better-auth "user".id) を追加。
-- v5: game_id を追加し、主キーを (game_id, island_id, position) に変更。
-- island_id はゲームごとに 1 から再採番されるため、旧主キー (island_id, position) のままでは
-- 別のゲームの同じ island_id の投稿と衝突する。そのため "ALTER TABLE ... ADD COLUMN" ではなく、
-- islands と同様に新表作成 → INSERT SELECT → DROP → RENAME で主キーに game_id を含めている。
CREATE TABLE lbbs_posts (
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

-- Perl: hakojima.logN (N = 何ターン前か)。turn 列で代替
-- v5: game_id を追加 (tmp/18-games.md)。
CREATE TABLE logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL DEFAULT 1,
  turn        INTEGER NOT NULL,
  seq         INTEGER NOT NULL,     -- 同一ターン内の表示順 (logFlush の出力順)
  secret      INTEGER NOT NULL DEFAULT 0,
  island_id   INTEGER NOT NULL DEFAULT 0,
  target_id   INTEGER NOT NULL DEFAULT 0,
  html        TEXT    NOT NULL
) STRICT;
CREATE INDEX logs_game_turn_seq ON logs(game_id, turn, seq);
CREATE INDEX logs_game_island   ON logs(game_id, island_id, turn);
CREATE INDEX logs_game_target   ON logs(game_id, target_id, turn);

-- Perl: hakojima.his
-- v5: game_id を追加 (tmp/18-games.md)。
CREATE TABLE history (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL DEFAULT 1,
  turn    INTEGER NOT NULL,
  html    TEXT    NOT NULL
) STRICT;
CREATE INDEX history_game ON history(game_id, id);

-- Workers 版のみ使用 (PITR ブックマークの台帳)。Node 版では空のまま
CREATE TABLE backups (
  label       TEXT    PRIMARY KEY,
  bookmark    TEXT    NOT NULL,
  turn        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
) STRICT;

-- ここから better-auth が所有する表。列名は better-auth の既定 (camelCase) のまま。
-- storage/better-auth-adapter.ts が読み書きする。
--
-- better-auth 1.7.5 (@better-auth/core の getAuthTables) の既定スキーマに issuer 列は
-- 存在しない (account は accountId/providerId の組で識別する)。node_modules 内の
-- get-tables.ts で確認した実際の列に合わせ、(provider_id, account_id) の UNIQUE INDEX を張る。
CREATE TABLE "user" (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
) STRICT;

CREATE TABLE session (
  id        TEXT PRIMARY KEY,
  token     TEXT NOT NULL UNIQUE,
  userId    TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT
) STRICT;
CREATE INDEX session_userId ON session(userId);

CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  password              TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX account_providerId_accountId ON account(providerId, accountId);
CREATE INDEX account_userId ON account(userId);

CREATE TABLE verification (
  id        TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value     TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
) STRICT;
CREATE INDEX verification_identifier ON verification(identifier);

-- アプリ側: 計画登録フォームの初期値。ゲームに依らない。
CREATE TABLE user_prefs (
  user_id TEXT NOT NULL PRIMARY KEY,
  prefs   TEXT NOT NULL
) STRICT;

-- アプリ側: 単純な key-value 設定。ログイン方法の ON/OFF (キー "auth.methods") 等に使う。
CREATE TABLE settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`;
