// Perl 版 Turn.pm の turnMain (ファイル I/O を除く部分) の移植。
// 1 ターン分の進行 (収入 → コマンド処理 → 成長/単ヘックス災害 → 島全体処理 → ソート → ターン杯 →
// 死滅島の除去) を純粋関数として提供する。
import type { GameConfig } from "../config.ts";
import { prizeNames } from "../constants.ts";
import { shuffledPoints } from "../geometry.ts";
import { LogCollector } from "../log/collector.ts";
import * as messages from "../log/messages.ts";
import { estimate } from "../island.ts";
import { withTurnPrize } from "../prize.ts";
import { randomArray } from "../rng.ts";
import type { Rng } from "../rng.ts";
import type { HistoryEntry, LogEntry, World } from "../types.ts";
import { doCommand } from "./command.ts";
import type { TurnContext } from "./context.ts";
import { getState } from "./context.ts";
import { doEachHex } from "./each-hex.ts";
import { income } from "./income.ts";
import { doIslandProcess } from "./island-process.ts";
import { islandSort } from "./sort.ts";

export interface TurnResult {
  /** 進行後の World (死滅島は除去済み、順位順)。 */
  world: World;
  /** 削除すべき島の ID。 */
  removedIslandIds: number[];
  logs: LogEntry[];
  history: HistoryEntry[];
}

export interface CreateTurnContextInput {
  config: GameConfig;
  rng: Rng;
  /** 初期値。runTurn がターン番号増加後の値で上書きする。 */
  turn: number;
}

/**
 * TurnContext の簡易ファクトリ。
 * ターンスコープのフィールド (turn/points/state/defenceCache/log) は `runTurn` が
 * 実行の都度作り直すので、ここでは仮値で構わない。
 */
export function createTurnContext(input: CreateTurnContextInput): TurnContext {
  return {
    config: input.config,
    rng: input.rng,
    turn: input.turn,
    points: [],
    state: new Map(),
    defenceCache: new Map(),
    log: new LogCollector(input.turn),
  };
}

/**
 * 1 ターン進める。world を直接書き換えるが、呼び出し側は返り値の world のみ使えばよい。
 *
 * 乱数消費順序 (Perl 版と同じ):
 * 1. `shuffledPoints` (ctx.points 相当。makeRandomPointArray) — ターン番号増加の前
 * 2. ターン番号増加
 * 3. `randomArray` (処理順) — ターン番号増加の後
 *
 * `ctx` の turn スコープのフィールド (turn/points/state/defenceCache/log) はここで
 * 上書きする。呼び出し側が `createTurnContext` 等で用意した値は初期値に過ぎない
 * (config/rng だけを引き継ぐ設計)。
 */
export function runTurn(world: World, ctx: TurnContext): TurnResult {
  // 最終更新時間を更新
  world.lastTime += ctx.config.unitTimeSec;

  // 座標配列を作る (ターン番号増加の前)
  ctx.points = shuffledPoints(ctx.config.islandSize, ctx.rng);

  // ターン番号
  world.turn += 1;
  ctx.turn = world.turn;
  ctx.log = new LogCollector(world.turn);
  ctx.state = new Map();
  ctx.defenceCache = new Map();

  const islands = world.islands;
  const n = islands.length;

  // 順番決め (ターン番号増加の後)
  const order = randomArray(n, ctx.rng);

  // 収入、消費フェイズ
  // tmp/19-abandon.md「ターン処理」節: 放棄島 (abandonedAt !== null) は収入・計画・成長・災害の
  // 各フェーズをスキップする。
  for (let i = 0; i < n; i++) {
    const island = islands[order[i]!]!;
    if (island.abandonedAt !== null) {
      continue;
    }
    estimate(island);
    income(island, ctx.config);
    // ターン開始前の人口をメモる
    getState(ctx, island.id).oldPop = island.pop;
  }

  // コマンド処理 (戻り値が consumed になるまで繰り返す)
  for (let i = 0; i < n; i++) {
    const island = islands[order[i]!]!;
    if (island.abandonedAt !== null) {
      continue;
    }
    while (doCommand(ctx, world, island) === "continue") {
      // 継続
    }
  }

  // 成長および単ヘックス災害
  for (let i = 0; i < n; i++) {
    const island = islands[order[i]!]!;
    if (island.abandonedAt !== null) {
      continue;
    }
    doEachHex(ctx, island);
  }

  // 島全体処理
  for (let i = 0; i < n; i++) {
    const island = islands[order[i]!]!;

    if (island.abandonedAt !== null) {
      // 放棄島: ターン末の死滅判定で除去する (pop === 0)。除去時のログは logDead ではなく
      // 通常ログ「放棄され、無人島になりました」(logGiveupNotice)。history は
      // GameService.abandonIsland が放棄した時点で既に1回記録しているため、ここでは
      // 出さない (二重記録防止)。
      const state = getState(ctx, island.id);
      state.dead = true;
      island.pop = 0;
      messages.logGiveupNotice(ctx.log, island.id, island.name);
      continue;
    }

    doIslandProcess(ctx, world, island);

    // 死滅判定
    const state = getState(ctx, island.id);
    if (state.dead) {
      island.pop = 0;
    } else if (island.pop === 0) {
      state.dead = true;
      messages.logDead(ctx.log, island.id, island.name);
    }
  }

  // 人口順にソート
  world.islands = islandSort(islands);

  // ターン杯対象ターンだったら、その処理 (死滅島の除去より前に判定する。Perl と同じ順序)
  if (world.turn % ctx.config.turnPrizeUnit === 0) {
    const top = world.islands[0];
    if (top !== undefined) {
      messages.logPrize(ctx.log, top.id, top.name, `${world.turn}${prizeNames[0] ?? ""}`);
      top.prize = withTurnPrize(top.prize, world.turn);
    }
  }

  // 死滅島を除去
  const removedIslandIds: number[] = [];
  world.islands = world.islands.filter((island) => {
    if (getState(ctx, island.id).dead) {
      removedIslandIds.push(island.id);
      return false;
    }
    return true;
  });

  const { logs, history } = ctx.log.flush();

  return { world, removedIslandIds, logs, history };
}
