// Perl 版 hakojima.dat / island.N / hakojima.logN / hakojima.his へのアクセスを抽象化する。
// tmp/04-database.md の「リポジトリインターフェース」節、tmp/14-users-auth.md、
// tmp/16-season.md、tmp/18-games.md (複数ゲーム) の移植。
// 実装 (SqliteGameRepository 等) は storage 層が持つ。
import type { HistoryEntry, Island, LbbsPost, LogEntry, Prize } from "../core/types.ts";

/** ゲームの状態。tmp/18-games.md「定義」節。 */
export type GameStatus = "running" | "finished";

/**
 * 1 ゲーム (1 シーズン) のメタ情報。Perl 版 hakojima.dat 先頭 4 行相当 +
 * tmp/18-games.md の `games` 表 1 行。島の数は listIslandSummaries(gameId).length で代替。
 */
export interface GameMeta {
  id: number;
  /** 省略時 '第 N 回'。 */
  name: string;
  status: GameStatus;
  turn: number;
  /**
   * ゲーム開始直後のターン番号。tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節。
   * 新方式のゲームは 0 (`createGame` が設定する)。スキーマ v7 移行前から動いていた旧方式の
   * ゲームは 1 のまま変わらない (番号・ログ・終了時刻を変えないため)。実行済みの処理回数は
   * `turn - firstTurn`。終了判定は新旧どちらも `turn >= finalTurn` (firstTurn は参照しない)。
   */
  firstTurn: number;
  lastTime: number;
  /**
   * ターン1の処理 (ゲーム開始) が実行される (実行された) unix 秒。`last_time` からの逆算は
   * `unitTimeSec` の変更に弱く分かりにくいため、DB に直接持つ列にしている。`createGame` 時に `lastTime` と同じ値で設定され、
   * 開始前 (turn=0) の間は `setLastTime` (管理画面「最終更新時刻の変更」) が同期して更新する
   * (tmp/16-season.md「開始前の状態 = ターン 0」節)。turn>=1 になった後は不変。
   */
  startAt: number;
  /** 最終ターン (tmp/16-season.md)。NULL なら無期限。 */
  finalTurn: number | null;
  /**
   * 1 ターンの長さ (秒)。tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。
   * `createGame` 時に `config.unitTimeSec` (または管理画面/CLI で指定した値) で設定され、
   * 以後は管理画面「ゲーム設定」/ CLI `game set-unit-time` でのみ変わる。ターン進行・
   * 次のターン予定・開始時刻の切り下げは以後すべてこの値を使う (`config.unitTimeSec` は
   * 新しいデータを作るときの既定値としてのみ使う)。
   */
  unitTimeSec: number;
  nextIslandId: number;
  createdAt: number;
  finishedAt: number | null;
}

/** ゲーム一覧 (現在 + 過去) の 1 行。tmp/18-games.md「ルート」節 GET /games の表。 */
export interface GameSummary {
  id: number;
  name: string;
  status: GameStatus;
  startAt: number;
  finishedAt: number | null;
  turn: number;
  finalTurn: number | null;
  islandCount: number;
}

/** 一覧用の軽量な島情報。地形・コマンド・掲示板を含まない (トップ画面/セレクト用)。 */
export interface IslandSummary {
  id: number;
  name: string;
  /** 島主の better-auth user.id。 */
  ownerUserId: string;
  comment: string;
  score: number;
  absent: number;
  money: number;
  food: number;
  pop: number;
  area: number;
  farm: number;
  factory: number;
  mountain: number;
  prize: Prize;
  /** 放棄した unix 秒。NULL = 有効。tmp/19-abandon.md。 */
  abandonedAt: number | null;
}

export interface ListLogsQuery {
  /** この値以上の turn のログのみ返す。 */
  sinceTurn: number;
  /** 指定時: island_id = islandId OR target_id = islandId のログのみ返す。 */
  islandId?: number;
  /** 指定時: secret = 1 かつ island_id = includeSecretFor のログも含める (開発画面用)。 */
  includeSecretFor?: number;
}

/**
 * 計画登録フォームの初期値。tmp/14-users-auth.md「データモデル」の `user_prefs` 節。
 * ログイン中ユーザーごとに 1 件保持する
 * (ゲームに依らない。tmp/18-games.md)。
 */
export interface UserPrefs {
  targetIslandId?: number;
  pointX?: number;
  pointY?: number;
  kind?: number;
}

/** `GameRepository.createGame` の入力。tmp/18-games.md「リポジトリ」節。 */
export interface CreateGameInput {
  name: string;
  startAt: number;
  finalTurn: number | null;
  unitTimeSec: number;
}

/**
 * ゲームデータへの読み書きを抽象化するリポジトリ。tmp/18-games.md により島・ログ・履歴・
 * 掲示板の各メソッドは第 1 引数に `gameId` を取る (同時に実行できるゲームは 1 つだが、
 * 過去のゲームは読み取り専用で残るため)。
 * `transaction` 内では await しない (02-architecture.md 「同時実行とロック」参照)。
 */
export interface GameRepository {
  /** 同期トランザクション。fn 内では await しない。 */
  transaction<T>(fn: () => T): T;

  /** ゲームが 1 つ以上あるか。 */
  isInitialized(): boolean;
  /** ゲーム一覧。id 降順 (新しい順)。 */
  listGames(): GameSummary[];
  /** 現在のゲーム (MAX(id)) の ID。ゲームが無ければ undefined。 */
  getCurrentGameId(): number | undefined;
  getMeta(gameId: number): GameMeta;
  /** `meta.id` で対象のゲームを特定して更新する。 */
  saveMeta(meta: GameMeta): void;
  /**
   * 新しいゲームを作る (turn=0, firstTurn=0, nextIslandId=1, status='running')。新しい ID を返す。
   * tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節: turn=0 が開始前を表す。
   */
  createGame(input: CreateGameInput, now: number): number;
  /** ゲームを終了状態にする (status='finished', finished_at=now)。 */
  finishGame(gameId: number, now: number): void;
  /**
   * 楽観ロック: 現在の turn が expectedTurn で status が 'running' のときだけ更新し、
   * 成功可否を返す (終了済みゲームを 'running' に戻す書き込みを防ぐ)。
   */
  tryBumpTurn(gameId: number, expectedTurn: number, next: GameMeta): boolean;

  /** 一覧用: rank 昇順 (0 が 1 位)。 */
  listIslandSummaries(gameId: number): IslandSummary[];
  /** 全島をフル (地形・コマンド・掲示板) で読み込む。ターン処理用。rank 昇順。 */
  loadAllIslands(gameId: number): Island[];
  findIsland(gameId: number, id: number): Island | undefined;
  findIslandByName(gameId: number, name: string): IslandSummary | undefined;
  /**
   * 1 ユーザー 1 島の制約の確認・自分の島の特定に使う (ゲームごと)。tmp/19-abandon.md:
   * 放棄されていない島 (`abandonedAt IS NULL`) だけを返す。
   */
  findIslandByOwner(gameId: number, userId: string): IslandSummary | undefined;

  insertIsland(gameId: number, island: Island, rank: number): void;
  /** rank 以外の全フィールドを更新する。 */
  updateIsland(gameId: number, island: Island): void;
  /** ターン処理後: 渡された順に rank を振り直し、含まれない ID (死滅島) を掲示板ごと削除する。 */
  replaceAllIslands(gameId: number, islands: Island[]): void;
  deleteIsland(gameId: number, id: number): void;

  replaceLbbs(gameId: number, islandId: number, posts: LbbsPost[]): void;

  appendLogs(gameId: number, entries: LogEntry[]): void;
  listLogs(gameId: number, q: ListLogsQuery): LogEntry[];
  /** turn 未満のログをすべて削除する。 */
  deleteLogsBefore(gameId: number, turn: number): void;

  appendHistory(gameId: number, entries: HistoryEntry[]): void;
  /** 新しい順に最大 limit 件。 */
  listHistory(gameId: number, limit: number): HistoryEntry[];
  trimHistory(gameId: number, keep: number): void;

  /** tmp/19-abandon.md「回数制限」節。(game_id, user_id) の放棄回数。 */
  countAbandonments(gameId: number, userId: string): number;
  /** 放棄の記録を `abandonments` 表に残す (放棄島がターン末に削除されても記録は残る)。 */
  recordAbandonment(
    gameId: number,
    userId: string,
    islandId: number,
    islandName: string,
    abandonedAt: number,
  ): void;

  /** 全テーブルの行を削除する (管理用)。better-auth の 4 表・user_prefs は対象外。 */
  reset(): void;

  /** 計画登録フォームの初期値。未保存なら undefined。 */
  getUserPrefs(userId: string): UserPrefs | undefined;
  setUserPrefs(userId: string, prefs: UserPrefs): void;
}

export interface BackupInfo {
  label: string;
  createdAt: number;
  turn: number;
}

/** バックアップは同期セクションの外で行うため非同期でよい。 */
export interface BackupStore {
  list(): Promise<BackupInfo[]>;
  create(label: string, turn: number): Promise<void>;
  restore(label: string): Promise<void>;
  delete(label: string): Promise<void>;
  rotate(keep: number): Promise<void>;
}

/** unix 秒を返す時計。Date.now を直接使わずこれを注入する。 */
export interface Clock {
  now(): number;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * メール送信の抽象化。tmp/14-users-auth.md 「メール送信」節。
 * better-auth の magicLink / emailVerification (changeEmail の確認リンク) から呼ばれる。
 */
export interface Mailer {
  send(mail: { to: string; subject: string; text: string }): Promise<void>;
}

/**
 * 単純な key-value 設定の保存。tmp/14-users-auth.md 「ログイン方法の設定 (settings 表)」節。
 * ゲームデータ (GameRepository) とは寿命・意味論が異なるため別ポートにする。
 */
export interface SettingsRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
