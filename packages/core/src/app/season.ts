// tmp/16-season.md 「定義」「状態判定」節 + tmp/18-games.md 「定義」節の移植。
// 開始時刻・最終ターン・状態列からゲームの状態を判定する。
import type { GameMeta, GameStatus } from "./ports.ts";

/**
 * 終了状態。tmp/18-games.md: 最終ターン到達か手動終了で `status` が 'finished' になる。
 */
export function isFinished(meta: GameMeta): boolean {
  return meta.status === "finished";
}

/**
 * 開始前: ゲーム開始直後 (まだ 1 回もターン処理をしていない)、終了していないゲームに限る。
 * tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20、ユーザー確認済み)」節: 新方式の
 * ゲームは `turn = 0` が開始前を表す (`now < startAt` は見ない。`turn === 0` で `now >= startAt`
 * の瞬間は、次のトリガーで処理されるまで「開始前」のまま)。旧方式 (firstTurn = 1) のゲームは
 * 既に turn >= 1 で作られているため、この関数は常に false を返す (旧方式の「開始前」は
 * スキーマ v7 マイグレーションで turn=0 に変換済み)。
 */
export function isBeforeStart(meta: GameMeta): boolean {
  return !isFinished(meta) && meta.turn === 0;
}

export type SeasonState = "before" | "running" | "finished";

/** トップ/開発/管理画面が共通で使うシーズンの状態。tmp/18-games.md でゲーム識別情報を追加。 */
export interface SeasonVM {
  /** tmp/18-games.md。 */
  gameId: number;
  gameName: string;
  status: GameStatus;
  turn: number;
  finalTurn: number | null;
  state: SeasonState;
  /** ターン 1 の処理 (ゲーム開始) が実行される (実行された) unix 秒。 */
  startAt: number;
  /**
   * 終了時のみ、終了時点のターン番号。最終ターン到達で終了した場合は finalTurn、
   * 管理者による手動終了の場合は終了時点の turn。
   */
  finishedAtTurn: number | null;
  /**
   * 次のターンが進む予定の unix 秒。`state === 'running'` のときだけ `lastTime + unitTimeSec`、
   * それ以外 (開始前・終了後) は null。トップ画面の「次のターン: …」表示に使う。
   */
  nextTurnAt: number | null;
  /**
   * 1 ターンの長さ (秒)。tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節: `meta.unitTimeSec`
   * をそのまま転記したもの。トップ/管理画面の「1 ターン = N時間M分」表示に使う。
   */
  unitTimeSec: number;
}

/**
 * `GameMeta` から `SeasonVM` を組み立てる。ターンの長さは `meta.unitTimeSec` (DB に持つ値) を
 * 使い、開始前かどうかは `turn === 0` だけで判定する (`isBeforeStart`) ため、現在時刻は受け取らない。
 */
export function buildSeasonVM(meta: GameMeta): SeasonVM {
  const finished = isFinished(meta);
  const state: SeasonState = finished ? "finished" : isBeforeStart(meta) ? "before" : "running";
  // 終了判定は `turn >= finalTurn` (firstTurn の新旧に関係なく最終ターンで止める)。
  // それ未満で終了した場合 (手動終了など) は終了時点の turn を返す。
  const finishedAtTurn = finished
    ? meta.finalTurn !== null && meta.turn >= meta.finalTurn
      ? meta.finalTurn
      : meta.turn
    : null;
  return {
    gameId: meta.id,
    gameName: meta.name,
    status: meta.status,
    turn: meta.turn,
    finalTurn: meta.finalTurn,
    state,
    startAt: meta.startAt,
    finishedAtTurn,
    nextTurnAt: state === "running" ? meta.lastTime + meta.unitTimeSec : null,
    unitTimeSec: meta.unitTimeSec,
  };
}
