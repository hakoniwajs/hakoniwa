// tmp/08-turn-trigger-admin-cli.md 「管理機能」節、tmp/14-users-auth.md
// 「ログイン方法の設定」節、tmp/18-games.md (複数ゲーム) の移植。
// Perl 版 Maintenance.pm (hako-mente.cgi) の各モードのユースケース化。
import type { AuthMethodsFlags, AuthMethodPolicy } from "./auth-methods.ts";
import { AppError } from "./errors.ts";
import type {
  BackupInfo,
  BackupStore,
  Clock,
  GameRepository,
  GameStatus,
  GameSummary,
} from "./ports.ts";
import type { SeasonVM } from "./season.ts";
import { buildSeasonVM, isFinished } from "./season.ts";
import type { TurnService } from "./turn-service.ts";
import type { GameConfig } from "../core/config.ts";

export interface AdminStatus {
  /** 現在のゲームがあるか (`repo.isInitialized()`)。 */
  initialized: boolean;
  /** 現在のゲームの ID/名前/状態。tmp/18-games.md「AdminService」節。初期化済みのときのみ。 */
  gameId?: number;
  gameName?: string;
  gameStatus?: GameStatus;
  turn?: number;
  lastTime?: number;
  backups: BackupInfo[];
  /** 開始時刻・最終ターン・状態 (開始前/進行中/終了)。tmp/16-season.md。初期化済みのときのみ。 */
  season?: SeasonVM;
  /** ゲーム一覧 (現在 + 過去)。tmp/18-games.md。 */
  games: GameSummary[];
}

/**
 * `AdminService.startGame`/`initialize` の入力。tmp/18-games.md「設定の入口」節、tmp/16-season.md。
 */
export interface StartGameOptions {
  /** 省略時は `第 ${newId} 回`。tmp/18-games.md。 */
  name?: string;
  /** 省略時は従来どおり `now` を `unitTimeSec` で切り下げる。 */
  startAt?: number;
  /** 省略時 (または未指定) は無期限 (null)。 */
  finalTurn?: number | null;
  /**
   * 1 ターンの長さ (秒)。tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。
   * 省略時は `config.unitTimeSec` (既定 21600)。開始時刻の切り下げにもこの値を使う。
   */
  unitTimeSec?: number;
}

/**
 * 後方互換のためのエイリアス型。`initialize`/CLI `db init`/管理画面の初期化フォームで
 * 使われてきた名前をそのまま残す (web/cli の第 2 段階の担当が参照する)。
 */
export type AdminInitializeOptions = StartGameOptions;

/** 管理画面のログイン方法設定 UI 向け VM。 */
export interface AuthMethodsVM {
  configured: AuthMethodsFlags;
  enabled: AuthMethodsFlags;
  /** true なら email は ConsoleMailer (開発用) で、本番設定 (Resend) はまだされていない。 */
  mailerIsConsole: boolean;
}

export interface AdminServiceDeps {
  repo: GameRepository;
  clock: Clock;
  config: GameConfig;
  backupStore: BackupStore;
  turnService: TurnService;
  authMethods: AuthMethodPolicy;
  mailerIsConsole: boolean;
}

/**
 * 設計書との差異: 08 の擬似コードは `status`/`listBackups`/`createBackup`/`restoreBackup`/
 * `deleteBackup` を同期シグネチャで示しているが、`BackupStore` (04-database.md) は
 * VACUUM INTO やブックマーク操作のため非同期である。ここでは実際に動く形として、
 * バックアップに触れるメソッドはすべて `Promise` を返す非同期メソッドにしている。
 * `startGame`/`initialize`/`reset`/`setLastTime`/`advanceTurn` は repo 操作のみなので同期のまま。
 */
export class AdminService {
  readonly #deps: AdminServiceDeps;

  constructor(deps: AdminServiceDeps) {
    this.#deps = deps;
  }

  #requireCurrentGameId(): number {
    const gameId = this.#deps.repo.getCurrentGameId();
    if (gameId === undefined) {
      throw new Error("AdminService: no current game");
    }
    return gameId;
  }

  async status(): Promise<AdminStatus> {
    const { repo, backupStore } = this.#deps;
    const backups = await backupStore.list();
    const games = repo.listGames();
    const gameId = repo.getCurrentGameId();
    if (gameId === undefined) {
      return { initialized: false, backups, games };
    }
    const meta = repo.getMeta(gameId);
    const season = buildSeasonVM(meta);
    return {
      initialized: true,
      gameId: meta.id,
      gameName: meta.name,
      gameStatus: meta.status,
      turn: meta.turn,
      lastTime: meta.lastTime,
      backups,
      season,
      games,
    };
  }

  /**
   * 新しいゲームを開始する。tmp/18-games.md「AdminService」節: 現在のゲームが無い、または
   * `finished` のときだけ成功する。それ以外は `AppError('game_running')` (409)。
   * Perl 版 Maintenance.pm newMode の移植: turn=0 (開始前。tmp/16-season.md「開始前の状態 =
   * ターン 0」節), nextIslandId=1。
   */
  startGame(input: StartGameOptions, now: number): number {
    const { repo, config } = this.#deps;
    return repo.transaction(() => {
      const currentId = repo.getCurrentGameId();
      if (currentId !== undefined) {
        const currentMeta = repo.getMeta(currentId);
        if (!isFinished(currentMeta)) {
          throw new AppError("game_running", "現在のゲームが終了していません。");
        }
      }
      const unitTimeSec = input.unitTimeSec ?? config.unitTimeSec;
      // startAt は開始前 (turn=0) の lastTime と同じ値で初期化する (16「開始時刻」の定義、
      // tmp/16-season.md「開始前の状態 = ターン 0」節)。
      const startAt = input.startAt ?? now - (now % unitTimeSec);
      const finalTurn = input.finalTurn ?? null;
      const nextId = (currentId ?? 0) + 1;
      const name = input.name ?? `第 ${nextId} 回`;
      return repo.createGame({ name, startAt, finalTurn, unitTimeSec }, now);
    });
  }

  /**
   * `startGame` のエイリアス。CLI `db init` の後方互換用: tmp/18-games.md「CLI」節
   * 「db init は『ゲームが無いときだけ game new』」により、既にゲームがあれば (running/finished
   * を問わず) 失敗する。
   */
  initialize(now: number, options: AdminInitializeOptions = {}): void {
    if (this.#deps.repo.isInitialized()) {
      throw new AppError("game_running", "既にゲームが存在します。`game new` を使ってください。");
    }
    this.startGame(options, now);
  }

  /** 現在のゲームを手動で終了する。tmp/18-games.md「AdminService」節。running でなければ失敗する。 */
  finishCurrentGame(now: number): void {
    const { repo } = this.#deps;
    repo.transaction(() => {
      const gameId = this.#requireCurrentGameId();
      const meta = repo.getMeta(gameId);
      if (isFinished(meta)) {
        throw new AppError("game_finished");
      }
      repo.finishGame(gameId, now);
    });
  }

  /** ゲーム一覧 (現在 + 過去)。tmp/18-games.md「ルート」節 GET /games の元データ。 */
  listGames(): GameSummary[] {
    return this.#deps.repo.listGames();
  }

  /** Perl 版 Maintenance.pm deleteMode (ID 指定なし = 現役データ削除) の移植。全ゲームを削除する。 */
  reset(): void {
    this.#deps.repo.reset();
  }

  /**
   * Perl 版 Maintenance.pm timeMode/stimeMode の移植。unix 秒を直接設定する (現在のゲームに対して)。
   * tmp/16-season.md「開始前の状態 = ターン 0 (改訂 2026-09-20)」節「管理操作」: turn===0 (開始前)
   * の間は最終更新時刻の変更が開始時刻の変更と同義なので `startAt` も追従させる (開始前 → 進行中の
   * 切替に使う)。turn>=1 は `lastTime` のみ変える (`startAt` は開始済みの記録として固定する)。
   */
  setLastTime(unix: number): void {
    const { repo } = this.#deps;
    repo.transaction(() => {
      const gameId = this.#requireCurrentGameId();
      const meta = repo.getMeta(gameId);
      const startAt = meta.turn === 0 ? unix : meta.startAt;
      repo.saveMeta({ ...meta, lastTime: unix, startAt });
    });
  }

  /**
   * 最終ターン数の変更 (現在のゲームに対して)。tmp/16-season.md「設定の入口」節 (管理画面
   * 「ゲーム設定」/ CLI `game set-final-turn`)。null で無期限に戻せる。
   */
  setFinalTurn(finalTurn: number | null): void {
    const { repo } = this.#deps;
    repo.transaction(() => {
      const gameId = this.#requireCurrentGameId();
      const meta = repo.getMeta(gameId);
      repo.saveMeta({ ...meta, finalTurn });
    });
  }

  /**
   * 1 ターンの長さ (秒) の変更 (現在のゲームに対して)。tmp/16-season.md「ターンの長さも DB に
   * 持つ (追加要件)」節 (管理画面「ゲーム設定」/ CLI `game set-unit-time`)。`lastTime` は
   * 変えないため、変更は次のターン境界 (`lastTime + 新しい値`) から効く。
   */
  setUnitTimeSec(unitTimeSec: number): void {
    if (!Number.isInteger(unitTimeSec) || unitTimeSec < 1) {
      throw new Error(
        `AdminService.setUnitTimeSec: must be a positive integer (got: ${unitTimeSec})`,
      );
    }
    const { repo } = this.#deps;
    repo.transaction(() => {
      const gameId = this.#requireCurrentGameId();
      const meta = repo.getMeta(gameId);
      repo.saveMeta({ ...meta, unitTimeSec });
    });
  }

  async listBackups(): Promise<BackupInfo[]> {
    return this.#deps.backupStore.list();
  }

  async createBackup(label?: string): Promise<void> {
    const gameId = this.#requireCurrentGameId();
    const meta = this.#deps.repo.getMeta(gameId);
    const finalLabel = label ?? `manual-${meta.turn}-${this.#deps.clock.now()}`;
    await this.#deps.backupStore.create(finalLabel, meta.turn);
  }

  /** Perl 版 Maintenance.pm currentMode の移植。 */
  async restoreBackup(label: string): Promise<void> {
    await this.#deps.backupStore.restore(label);
  }

  /** Perl 版 Maintenance.pm deleteMode (ID 指定あり) の移植。 */
  async deleteBackup(label: string): Promise<void> {
    await this.#deps.backupStore.delete(label);
  }

  /** 手動でのターン進行。TurnService に委譲する (現在のゲームに対して)。 */
  advanceTurn(now: number): void {
    this.#deps.turnService.advanceTurn(now);
  }

  /**
   * 資金・食料を最大化する (現在のゲームに対して)。tmp/14-users-auth.md「決定事項」6:
   * 特殊パスワードの代わりに管理画面の操作として残したもの。
   */
  maximizeIsland(id: number): void {
    const { repo } = this.#deps;
    repo.transaction(() => {
      const gameId = this.#requireCurrentGameId();
      const island = repo.findIsland(gameId, id);
      if (island === undefined) {
        throw new Error(`AdminService.maximizeIsland: island not found: ${id}`);
      }
      island.money = 9999;
      island.food = 9999;
      repo.updateIsland(gameId, island);
    });
  }

  /** ログイン方法 (X/Discord/メール) の設定済み・有効状態。管理画面のトグル表示用。 */
  getAuthMethods(): AuthMethodsVM {
    const { authMethods, mailerIsConsole } = this.#deps;
    return {
      configured: authMethods.configured(),
      enabled: authMethods.enabled(),
      mailerIsConsole,
    };
  }

  /** 管理画面からのログイン方法 ON/OFF 切り替え。 */
  setAuthMethods(methods: AuthMethodsFlags): void {
    this.#deps.authMethods.setEnabled(methods);
  }
}
