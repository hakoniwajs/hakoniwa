// tmp/08-turn-trigger-admin-cli.md 「ターン進行トリガー」節 + tmp/18-games.md (複数ゲーム) の移植。
// Perl 版 Main.pm readIslandsFile のターン判定 + Turn.pm turnMain の移植。
import type { BackupStore, GameMeta, GameRepository, Logger } from "./ports.ts";
import { isFinished } from "./season.ts";
import type { GameConfig } from "../core/config.ts";
import type { Rng } from "../core/rng.ts";
import type { World } from "../core/types.ts";
import { createTurnContext, runTurn } from "../core/turn/index.ts";

export interface TurnServiceDeps {
  repo: GameRepository;
  config: GameConfig;
  rng: Rng;
  backupStore: BackupStore;
  logger: Logger;
}

// tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節「進行判定」:
// turn===0 (開始前) は `now >= startAt` で期限到来とみなす (lastTime は見ない)。
// turn>=1 は `now - lastTime >= unitTimeSec`。
// tmp/16-season.md「ターンの長さも DB に持つ」節: 期限判定は config ではなく
// meta.unitTimeSec (管理画面「ゲーム設定」/ CLI `game set-unit-time` で変更された値) を使う。
function isDue(meta: GameMeta, now: number): boolean {
  return meta.turn === 0 ? now >= meta.startAt : now - meta.lastTime >= meta.unitTimeSec;
}

// 管理者の手動進行 (advanceTurn) も、開始前 (turn===0) で `now < startAt` のときは進めない。
function mayManuallyAdvance(meta: GameMeta, now: number): boolean {
  return meta.turn !== 0 || now >= meta.startAt;
}

/**
 * ターン進行。08 のアルゴリズムどおり `advanceTurnIfDue`/`advanceTurn` は同期関数として保つ。
 * tmp/18-games.md「TurnService」節: 現在のゲーム (`repo.getCurrentGameId()`) だけを対象にする。
 * ゲームが無い、または現在のゲームが `running` でなければ何もしない。
 *
 * `BackupStore` は非同期 (04-database.md) であり、同期関数の中で await することはできない。
 * そのため、バックアップ作成はターン処理のトランザクションが確定した後に
 * `void backupStore.create(...).then(() => backupStore.rotate(...)).catch(logger.error)` の形で
 * fire-and-forget 呼び出しにしている。呼び出し元はバックアップの完了を待たない。
 */
export class TurnService {
  readonly #deps: TurnServiceDeps;

  constructor(deps: TurnServiceDeps) {
    this.#deps = deps;
  }

  /** 期限が来ていれば `config.maxCatchUpTurns` を上限に進める。進めたターン数を返す。 */
  advanceTurnIfDue(now: number): number {
    const { repo, config } = this.#deps;
    let count = 0;
    for (let i = 0; i < config.maxCatchUpTurns; i++) {
      const gameId = repo.getCurrentGameId();
      if (gameId === undefined) {
        break;
      }
      const meta = repo.getMeta(gameId);
      // tmp/16-season.md「ターン進行」節 + tmp/18-games.md: 終了後はそれ以上進めない。
      if (isFinished(meta) || !isDue(meta, now)) {
        break;
      }
      const advancedTurn = this.#advanceOnce(gameId, now, isDue);
      if (advancedTurn === undefined) {
        break;
      }
      count++;
    }
    return count;
  }

  /** 期限に関係なく 1 ターン進める (デバッグ/管理用)。現在のゲームが無い/終了後は何もしない。 */
  advanceTurn(now: number): void {
    const { repo } = this.#deps;
    const gameId = repo.getCurrentGameId();
    if (gameId === undefined) {
      return;
    }
    const meta = repo.getMeta(gameId);
    // tmp/16-season.md「ターン進行」節 + tmp/18-games.md: 終了後はそれ以上進めない。
    if (isFinished(meta) || !mayManuallyAdvance(meta, now)) {
      return;
    }
    this.#advanceOnce(gameId, now, mayManuallyAdvance);
  }

  /**
   * 1 ターン分の進行を試みる。`tryBumpTurn` の楽観ロックに失敗したら undefined を返す。
   * 成功したら進行後の turn 番号を返す (呼び出し元がバックアップ要否の判定に使う)。
   * 進行後に最終ターンへ達したら、同じトランザクション内で `finishGame` を呼ぶ
   * (tmp/18-games.md「TurnService」節、tmp/16-season.md「開始前の状態 = ターン 0」節)。
   *
   * 終了・期限の判定と `next`/`world` の構築はトランザクション内で読み直した meta を使う:
   * 呼び出し元の `getMeta` からトランザクション開始までの間に他の書き込み (CLI の
   * `game finish`/`game set-final-turn`/`time set` 等) が入っても、古い
   * `status`/`final_turn`/`finished_at`/`last_time` で上書きして戻さないようにするため。
   */
  #advanceOnce(
    gameId: number,
    now: number,
    mayAdvance: (meta: GameMeta, now: number) => boolean,
  ): number | undefined {
    const { repo, config, rng } = this.#deps;
    let newTurn: number | undefined;

    const advanced = repo.transaction(() => {
      const meta = repo.getMeta(gameId);
      if (isFinished(meta) || !mayAdvance(meta, now)) {
        return false;
      }
      // 既に finalTurn 以上の turn に達している実行中ゲーム (firstTurn=1 の旧方式で
      // `turn > finalTurn` を待って残っていたもの等) はこれ以上進めず、終了だけ行う。
      if (meta.finalTurn !== null && meta.turn >= meta.finalTurn) {
        repo.finishGame(gameId, now);
        return false;
      }
      const next: GameMeta = {
        ...meta,
        turn: meta.turn + 1,
        // tmp/16-season.md「開始前の状態 = ターン 0」節「進行判定」: turn===0 (開始前) の
        // 処理では lastTime を startAt に据え置く (以降の期限は startAt + k * unitTimeSec)。
        // turn>=1 は unitTimeSec を加算する。
        lastTime: meta.turn === 0 ? meta.startAt : meta.lastTime + meta.unitTimeSec,
      };
      if (!repo.tryBumpTurn(gameId, meta.turn, next)) {
        return false;
      }

      const islands = repo.loadAllIslands(gameId);
      const world: World = {
        turn: meta.turn,
        lastTime: meta.lastTime,
        nextIslandId: meta.nextIslandId,
        islands,
      };
      // tmp/16-season.md「ターンの長さも DB に持つ」節: runTurn に渡す config は
      // meta.unitTimeSec で上書きする (runTurn 内の `world.lastTime += ctx.config.unitTimeSec` も
      // meta の値に従わせるため)。
      const turnConfig: GameConfig = { ...config, unitTimeSec: meta.unitTimeSec };
      const ctx = createTurnContext({ config: turnConfig, rng, turn: meta.turn });
      const result = runTurn(world, ctx);

      repo.replaceAllIslands(gameId, result.world.islands);
      repo.appendLogs(gameId, result.logs);
      repo.appendHistory(gameId, result.history);
      repo.deleteLogsBefore(gameId, result.world.turn - config.logKeepTurns + 1);
      repo.trimHistory(gameId, config.historyMax);

      // 最終ターンに達したら同じトランザクション内で終了する。判定は `turn >= finalTurn`
      // (firstTurn の新旧に関係なく、カウンタが finalTurn を超えないように止める)。
      if (next.finalTurn !== null && next.turn >= next.finalTurn) {
        repo.finishGame(gameId, now);
      }

      newTurn = result.world.turn;
      return true;
    });

    if (!advanced || newTurn === undefined) {
      return undefined;
    }

    if (newTurn % config.backupEveryTurns === 0) {
      this.#scheduleBackup(newTurn);
    }
    return newTurn;
  }

  #scheduleBackup(turn: number): void {
    const { backupStore, config, logger } = this.#deps;
    void backupStore
      .create(`turn-${turn}`, turn)
      .then(() => backupStore.rotate(config.backupKeep))
      .catch((err: unknown) =>
        logger.error(`バックアップの作成に失敗しました (turn=${turn})`, err),
      );
  }
}
