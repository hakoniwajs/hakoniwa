// tmp/06-web-routes-and-views.md 「ユースケース呼び出し」の GameService の実装。
// tmp/14-users-auth.md (better-auth への置き換え)、tmp/15-ng-words-and-mobile.md (NG ワード)、
// tmp/18-games.md (複数ゲーム) 反映。
// Perl 版 Map.pm (printIslandMain/ownerMain/commandMain/commentMain/localBbsMain) と
// Turn.pm (newIslandMain/changeMain) の移植。
import type { AuthUser } from "./auth.ts";
import { AppError } from "./errors.ts";
import { findNgWord } from "../core/ng-words.ts";
import {
  MAX_COMMENT_LEN,
  MAX_LBBS_MESSAGE_LEN,
  MAX_NAME_LEN,
  isBadIslandName,
  sanitizeText,
} from "./sanitize.ts";
import type { GameMeta, GameRepository, IslandSummary, UserPrefs } from "./ports.ts";
import type { Clock } from "./ports.ts";
import type { SiteSettingsReader } from "./site-settings.ts";
import { buildSeasonVM, isFinished } from "./season.ts";
import type { SeasonVM } from "./season.ts";
import { buildIslandOgpVM, buildMoneyDisplay } from "./view-models.ts";
import type {
  GameHeaderVM,
  GameListItemVM,
  IslandDetailVM,
  IslandPageVM,
  NewIslandVM,
  OwnerPageVM,
  TopPageVM,
} from "./view-models.ts";
import type { GameConfig } from "../core/config.ts";
import { CommandKind, commandSpecs, LandKind } from "../core/constants.ts";
import { autoPrepare, clearAll, deleteAt, insertAt, writeAt } from "../core/commands/queue.ts";
import { formatCommand } from "../core/commands/format.ts";
import type { ResolveIslandName } from "../core/commands/format.ts";
import { shuffledPoints } from "../core/geometry.ts";
import { estimate, makeNewIsland } from "../core/island.ts";
import { LogCollector } from "../core/log/collector.ts";
import * as messages from "../core/log/messages.ts";
import { flagPrizes, killedMonsters, turnPrizes } from "../core/prize.ts";
import type { Rng } from "../core/rng.ts";
import type { Command, Island, LbbsPost } from "../core/types.ts";

/** 計画登録フォームの入力値。web 層のフォームからそのまま渡ってくる想定 (未検証の raw な数値)。 */
export interface CommandInput {
  /** 登録先の欄番号 (0 始まり)。 */
  number: number;
  kind: number;
  x: number;
  y: number;
  /** Command.arg。 */
  amount: number;
  target: number;
  mode: "insert" | "write" | "delete";
}

export interface GameServiceDeps {
  repo: GameRepository;
  clock: Clock;
  config: GameConfig;
  rng: Rng;
  /**
   * サイト設定 (追加 NG ワード・ローカル掲示板の有無)。管理画面から実行中に変わるため
   * 呼び出しごとに `get()` で読む。
   */
  siteSettings: SiteSettingsReader;
}

function buildDetailVM(island: Island, rank: number, turn: number): IslandDetailVM {
  return {
    id: island.id,
    name: island.name,
    rank,
    turn,
    absent: island.absent,
    pop: island.pop,
    area: island.area,
    food: island.food,
    farm: island.farm,
    factory: island.factory,
    mountain: island.mountain,
    comment: island.comment,
    prize: {
      turnPrizes: turnPrizes(island.prize),
      flagPrizes: flagPrizes(island.prize),
      killedMonsters: killedMonsters(island.prize),
    },
    terrain: island.terrain,
  };
}

/**
 * Perl 版 Map.pm / Turn.pm の各 *Main のユースケース化。v3 (tmp/18-games.md 複数ゲーム対応) 版。
 * 各メソッドは対象のゲームを `gameId` で明示的に受け取る (同時に実行できるゲームは 1 つだが、
 * 過去のゲームは読み取り専用で残るため)。書き込み系は「gameId が現在のゲームかどうか」
 * および「running かどうか」で可否が分かれる (メソッドごとの規約は各実装のコメント参照)。
 */
export class GameService {
  readonly #deps: GameServiceDeps;

  constructor(deps: GameServiceDeps) {
    this.#deps = deps;
  }

  // ----------------------------------------------------------------------
  // 認可・ゲーム状態まわりの共通処理 (tmp/14-users-auth.md 「認可ルール」節、tmp/18-games.md)
  // ----------------------------------------------------------------------

  #requireLogin(actor: AuthUser | undefined): AuthUser {
    if (actor === undefined) {
      throw new AppError("login_required");
    }
    return actor;
  }

  /** ログイン済みかつ (指定ゲームで) 自分の島の IslandSummary を返す。無ければ no_island。 */
  #requireOwnIsland(
    actor: AuthUser | undefined,
    gameId: number,
  ): { user: AuthUser; summary: IslandSummary } {
    const user = this.#requireLogin(actor);
    const summary = this.#deps.repo.findIslandByOwner(gameId, user.id);
    if (summary === undefined) {
      throw new AppError("no_island");
    }
    return { user, summary };
  }

  #requireNgWordFree(text: string): void {
    const ngWord = findNgWord(text, this.#deps.siteSettings.get().ngWords);
    if (ngWord !== undefined) {
      // 利用者にはどの語が引っかかったかを見せない (15「照合ルール」6)。
      throw new AppError("ng_word");
    }
  }

  #gameExists(gameId: number): boolean {
    return this.#deps.repo.listGames().some((g) => g.id === gameId);
  }

  /** 読み取り専用の画面 (トップ/観光/OGP/開発画面の閲覧) 用: ゲームが存在すればよい (過去でもよい)。 */
  #requireExistingGame(gameId: number): GameMeta {
    if (!this.#deps.repo.isInitialized()) {
      throw new AppError("not_initialized");
    }
    if (!this.#gameExists(gameId)) {
      throw new AppError("game_not_found");
    }
    return this.#deps.repo.getMeta(gameId);
  }

  /**
   * 記帳 (postLbbs/deleteLbbs) 用: tmp/16-season.md「ターン進行」節により、現在のゲームの掲示板は
   * 終了後も記帳できる (running かどうかは問わない)。tmp/18-games.md「過去のゲームで閲覧できる
   * もの」により、現在でない (過去の) ゲームの掲示板には記帳できない。
   */
  #requireCurrentGame(gameId: number): GameMeta {
    const currentId = this.#deps.repo.getCurrentGameId();
    if (currentId === undefined) {
      throw new AppError("not_initialized");
    }
    if (gameId !== currentId) {
      throw new AppError(this.#gameExists(gameId) ? "game_finished" : "game_not_found");
    }
    return this.#deps.repo.getMeta(gameId);
  }

  /**
   * 更新系 (createIsland/registerCommand/updateComment/changeName) 用: tmp/18-games.md
   * 「GameService」節: 「gameId が現在のゲーム かつ status running」のときだけ許可する。
   */
  #requireWritableGame(gameId: number): GameMeta {
    const meta = this.#requireCurrentGame(gameId);
    if (isFinished(meta)) {
      throw new AppError("game_finished");
    }
    return meta;
  }

  #buildGameHeader(meta: GameMeta): GameHeaderVM {
    const currentId = this.#deps.repo.getCurrentGameId();
    return { id: meta.id, name: meta.name, status: meta.status, isCurrent: meta.id === currentId };
  }

  #findRank(id: number, summaries: { id: number }[]): number {
    const index = summaries.findIndex((s) => s.id === id);
    return index === -1 ? 0 : index + 1;
  }

  // ----------------------------------------------------------------------
  // 画面の組み立て (repo からの読み出し。同期)
  // ----------------------------------------------------------------------

  #buildIslandPageVM(gameId: number, id: number): IslandPageVM {
    const { repo, config } = this.#deps;
    const island = repo.findIsland(gameId, id);
    if (island === undefined) {
      throw new AppError("island_not_found");
    }
    const rank = this.#findRank(id, repo.listIslandSummaries(gameId));
    const meta = repo.getMeta(gameId);
    const sinceTurn = meta.turn - config.logKeepTurns + 1;
    const logs = repo.listLogs(gameId, { sinceTurn, islandId: id });
    const detail = buildDetailVM(island, rank, meta.turn);
    return {
      ...detail,
      moneyDisplay: buildMoneyDisplay(island.money, config, false),
      lbbs: island.lbbs,
      logs,
      ogp: buildIslandOgpVM(detail, gameId, config),
      game: this.#buildGameHeader(meta),
    };
  }

  #buildOwnerPageVM(gameId: number, id: number, userId: string): OwnerPageVM {
    const { repo, config } = this.#deps;
    const island = repo.findIsland(gameId, id);
    if (island === undefined) {
      throw new AppError("island_not_found");
    }
    const summaries = repo.listIslandSummaries(gameId);
    const rank = this.#findRank(id, summaries);
    const nameById = new Map(summaries.map((s) => [s.id, s.name] as const));
    const resolveIslandName: ResolveIslandName = (targetId) => nameById.get(targetId);
    const meta = repo.getMeta(gameId);
    const sinceTurn = meta.turn - config.logKeepTurns + 1;
    const logs = repo.listLogs(gameId, { sinceTurn, islandId: id, includeSecretFor: id });
    const commands = island.commands.map((command, index) =>
      formatCommand(command, index, config, resolveIslandName),
    );
    const defaults: UserPrefs = repo.getUserPrefs(userId) ?? {};
    const season = buildSeasonVM(meta);
    const abandonCount = repo.countAbandonments(gameId, userId);
    return {
      ...buildDetailVM(island, rank, meta.turn),
      money: island.money,
      commands,
      rawCommands: island.commands,
      lbbs: island.lbbs,
      logs,
      defaults,
      season,
      game: this.#buildGameHeader(meta),
      abandon: { remaining: Math.max(0, config.maxAbandonsPerGame - abandonCount) },
    };
  }

  // ----------------------------------------------------------------------
  // ゲーム一覧 (tmp/18-games.md「ルート」節 GET /games)
  // ----------------------------------------------------------------------

  listGames(): GameListItemVM[] {
    const { repo } = this.#deps;
    const currentId = repo.getCurrentGameId();
    return repo.listGames().map((g) => ({ ...g, isCurrent: g.id === currentId }));
  }

  /** web 層がゲーム未指定のルート (`/`, `/my-island` 等) を現在のゲームへ解決するために使う。 */
  getCurrentGameId(): number | undefined {
    return this.#deps.repo.getCurrentGameId();
  }

  // ----------------------------------------------------------------------
  // トップ / 観光
  // ----------------------------------------------------------------------

  /** Perl 版 Top.pm topPageMain の移植。 */
  getTopPage(actor: AuthUser | undefined, gameId: number): TopPageVM {
    const meta = this.#requireExistingGame(gameId);
    const { repo, config } = this.#deps;
    const summaries = repo.listIslandSummaries(gameId);
    const islands = summaries.map((s, index) => ({
      id: s.id,
      name: s.name,
      rank: index + 1,
      absent: s.absent,
      pop: s.pop,
      area: s.area,
      food: s.food,
      farm: s.farm,
      factory: s.factory,
      mountain: s.mountain,
      moneyDisplay: buildMoneyDisplay(s.money, config, false),
      prize: {
        turnPrizes: turnPrizes(s.prize),
        flagPrizes: flagPrizes(s.prize),
        killedMonsters: killedMonsters(s.prize),
      },
      comment: s.comment,
      abandoned: s.abandonedAt !== null,
    }));
    const sinceTurn = meta.turn - config.topLogTurns + 1;
    const logs = repo.listLogs(gameId, { sinceTurn });
    const history = repo.listHistory(gameId, config.historyMax);
    const hasIsland = actor !== undefined && repo.findIslandByOwner(gameId, actor.id) !== undefined;
    const season = buildSeasonVM(meta);
    const game = this.#buildGameHeader(meta);
    return {
      turn: meta.turn,
      islands,
      canCreate: game.isCurrent && !isFinished(meta) && summaries.length < config.maxIslands,
      logs,
      history,
      debug: config.debug,
      viewer: { ...(actor !== undefined ? { user: actor } : {}), hasIsland },
      season,
      game,
    };
  }

  /** Perl 版 Map.pm printIslandMain の移植。誰でも見られる (14「認可ルール」節)。過去のゲームも可。 */
  getIslandPage(gameId: number, id: number): IslandPageVM {
    this.#requireExistingGame(gameId);
    return this.#buildIslandPageVM(gameId, id);
  }

  /**
   * OGP 画像 (地図 PNG) 生成用。tmp/17-ogp.md。認証・セッションに依存しない (誰でも同じ画像)。
   * Perl 版には無い (v2 独自の追加)。
   * `game`/`season` は tmp/21-kv-snapshot-cache.md「OGP 画像のキャッシュ期間」節向け:
   * 過去のゲーム/終了済みのゲームの画像は不変なので、呼び出し側 (routes/islands.tsx) が
   * `Cache-Control` を長期 (immutable) にするかどうかの判定に使う。
   */
  getIslandOgp(
    gameId: number,
    id: number,
  ): { island: Island; turn: number; game: GameHeaderVM; season: SeasonVM } {
    const meta = this.#requireExistingGame(gameId);
    const island = this.#deps.repo.findIsland(gameId, id);
    if (island === undefined) {
      throw new AppError("island_not_found");
    }
    return {
      island,
      turn: meta.turn,
      game: this.#buildGameHeader(meta),
      season: buildSeasonVM(meta),
    };
  }

  /**
   * Perl 版 Map.pm ownerMain の移植。actor 自身の島を開く (ゲームごとに 1 ユーザー 1 島)。
   * 過去のゲームは読み取り専用 (season.state/game.isCurrent を見て web 層がフォームを隠す)。
   */
  openOwnerPage(actor: AuthUser | undefined, gameId: number): OwnerPageVM {
    this.#requireExistingGame(gameId);
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    return this.#buildOwnerPageVM(gameId, summary.id, user.id);
  }

  // ----------------------------------------------------------------------
  // 新規作成
  // ----------------------------------------------------------------------

  /** Perl 版 Turn.pm newIslandMain の移植。ログイン必須、ゲームごとに 1 ユーザー 1 島。 */
  createIsland(actor: AuthUser | undefined, gameId: number, name: string): NewIslandVM {
    this.#requireWritableGame(gameId);
    const user = this.#requireLogin(actor);
    const { repo, config } = this.#deps;
    const cleanName = sanitizeText(name, MAX_NAME_LEN);

    // 事前検証: 1 島制約 → 上限 → 名前空 → 禁止文字/無人 → NG ワード → 重複。
    const validate = (): void => {
      if (repo.findIslandByOwner(gameId, user.id) !== undefined) {
        throw new AppError("already_has_island");
      }
      if (repo.listIslandSummaries(gameId).length >= config.maxIslands) {
        throw new AppError("island_full");
      }
      if (cleanName === "") {
        throw new AppError("no_name");
      }
      if (isBadIslandName(cleanName)) {
        throw new AppError("bad_name");
      }
      this.#requireNgWordFree(cleanName);
      if (repo.findIslandByName(gameId, cleanName) !== undefined) {
        throw new AppError("name_taken");
      }
    };
    validate();

    return repo.transaction(() => {
      // トランザクション内で改めて検証する (TOCTOU 対策)。
      validate();

      const meta = repo.getMeta(gameId);
      const island = makeNewIsland(config, this.#deps.rng, {
        id: meta.nextIslandId,
        name: cleanName,
        ownerUserId: user.id,
      });
      estimate(island);

      const rank = repo.listIslandSummaries(gameId).length;
      repo.insertIsland(gameId, island, rank);
      repo.saveMeta({ ...meta, nextIslandId: meta.nextIslandId + 1 });

      const log = new LogCollector(meta.turn);
      messages.logDiscover(log, cleanName);
      const { history } = log.flush();
      repo.appendHistory(gameId, history);

      return {
        ...buildDetailVM(island, rank + 1, meta.turn),
        money: island.money,
      };
    });
  }

  // ----------------------------------------------------------------------
  // 計画登録
  // ----------------------------------------------------------------------

  #validateCommandInput(input: CommandInput): void {
    const { config } = this.#deps;
    if (!Number.isInteger(input.number) || input.number < 0 || input.number >= config.commandMax) {
      throw new AppError("invalid_input");
    }
    if (commandSpecs[input.kind as CommandKind] === undefined) {
      throw new AppError("invalid_input");
    }
    if (!Number.isInteger(input.x) || input.x < 0 || input.x >= config.islandSize) {
      throw new AppError("invalid_input");
    }
    if (!Number.isInteger(input.y) || input.y < 0 || input.y >= config.islandSize) {
      throw new AppError("invalid_input");
    }
    if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > 99) {
      throw new AppError("invalid_input");
    }
    if (!Number.isInteger(input.target) || input.target < 0) {
      throw new AppError("invalid_input");
    }
    if (input.mode !== "insert" && input.mode !== "write" && input.mode !== "delete") {
      throw new AppError("invalid_input");
    }
  }

  /**
   * Perl 版 Map.pm commandMain の移植。actor 自身の島に対してのみ実行できる。
   * tmp/16-season.md「開始前の状態 (追加要件)」節の当初案では開始前の計画登録を拒否していたが、
   * コーディネーターの追加指示によりこの制限を撤回した (設計書との差異)。計画登録は島の作成・
   * コメント・名前変更・掲示板と同じく開始前でも行える (開始前に登録した計画は、ゲーム開始時刻
   * に実行される最初のターン処理 (tmp/16-season.md「開始前の状態 = ターン 0」節) で実行される)。
   */
  registerCommand(
    actor: AuthUser | undefined,
    gameId: number,
    input: CommandInput,
  ): OwnerPageVM & { notice: string } {
    this.#requireWritableGame(gameId);
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    const id = summary.id;
    this.#validateCommandInput(input);
    const { repo, config } = this.#deps;

    return repo.transaction(() => {
      const island = repo.findIsland(gameId, id);
      if (island === undefined) {
        throw new AppError("island_not_found");
      }
      const { commands } = island;
      const max = config.commandMax;
      const kind = input.kind as CommandKind;

      if (input.mode === "delete") {
        deleteAt(commands, input.number, max);
      } else if (kind === CommandKind.AutoPrepare || kind === CommandKind.AutoPrepare2) {
        // 登録すべき実コマンド種別 (整地/地ならし) に変換して渡す。AutoPrepare/AutoPrepare2 (61/62)
        // はあくまで UI 上の「自動入力」操作を表す値であり、そのまま計画として保存してはいけない
        // (保存すると turn/command.ts の switch に該当 case が無く、何もせず 1 枠消費するだけになる)。
        const prepareKind =
          kind === CommandKind.AutoPrepare ? CommandKind.Prepare : CommandKind.Prepare2;
        const points = shuffledPoints(config.islandSize, this.#deps.rng);
        autoPrepare(commands, input.number, island.terrain, prepareKind, points, max);
      } else if (kind === CommandKind.AutoDelete) {
        clearAll(commands, max);
      } else {
        const command: Command = {
          kind,
          target: input.target,
          x: input.x,
          y: input.y,
          arg: input.amount,
        };
        if (input.mode === "insert") {
          insertAt(commands, input.number, command);
        } else {
          writeAt(commands, input.number, command);
        }
      }

      repo.updateIsland(gameId, island);
      repo.setUserPrefs(user.id, {
        targetIslandId: input.target,
        pointX: input.x,
        pointY: input.y,
        kind: input.kind,
      });
      // Perl 版 commandMain は delete モードと AutoDelete (全消し) を tempCommandDelete、
      // それ以外 (insert/write/AutoPrepare/AutoPrepare2) を tempCommandAdd で表示する。
      const notice =
        input.mode === "delete" || kind === CommandKind.AutoDelete
          ? "コマンドを削除しました。"
          : "コマンドを登録しました。";
      return { ...this.#buildOwnerPageVM(gameId, id, user.id), notice };
    });
  }

  // ----------------------------------------------------------------------
  // コメント
  // ----------------------------------------------------------------------

  /** Perl 版 Map.pm commentMain の移植。actor 自身の島に対してのみ実行できる。 */
  updateComment(
    actor: AuthUser | undefined,
    gameId: number,
    message: string,
  ): OwnerPageVM & { notice: string } {
    this.#requireWritableGame(gameId);
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    const { repo } = this.#deps;
    const comment = sanitizeText(message, MAX_COMMENT_LEN);
    this.#requireNgWordFree(comment);

    return repo.transaction(() => {
      const island = repo.findIsland(gameId, summary.id);
      if (island === undefined) {
        throw new AppError("island_not_found");
      }
      island.comment = comment;
      repo.updateIsland(gameId, island);
      return {
        ...this.#buildOwnerPageVM(gameId, summary.id, user.id),
        notice: "コメントを更新しました。",
      };
    });
  }

  // ----------------------------------------------------------------------
  // 名前変更 (旧 changeSettings。パスワードは廃止)
  // ----------------------------------------------------------------------

  /** Perl 版 Turn.pm changeMain の移植。actor 自身の島に対してのみ実行できる。 */
  changeName(
    actor: AuthUser | undefined,
    gameId: number,
    name: string,
  ): OwnerPageVM & { notice: string } {
    this.#requireWritableGame(gameId);
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    const { repo, config } = this.#deps;
    const cleanName = sanitizeText(name, MAX_NAME_LEN);

    if (cleanName === "") {
      throw new AppError("no_name");
    }
    if (isBadIslandName(cleanName)) {
      throw new AppError("bad_name");
    }
    this.#requireNgWordFree(cleanName);

    return repo.transaction(() => {
      const island = repo.findIsland(gameId, summary.id);
      if (island === undefined) {
        throw new AppError("island_not_found");
      }
      if (repo.findIslandByName(gameId, cleanName) !== undefined && cleanName !== island.name) {
        throw new AppError("name_taken");
      }
      if (island.money < config.costChangeName) {
        throw new AppError("no_money");
      }
      island.money -= config.costChangeName;

      const log = new LogCollector(repo.getMeta(gameId).turn);
      messages.logChangeName(log, island.name, cleanName);
      const { history } = log.flush();
      repo.appendHistory(gameId, history);
      island.name = cleanName;
      repo.updateIsland(gameId, island);

      return {
        ...this.#buildOwnerPageVM(gameId, summary.id, user.id),
        notice: "名前を変更しました。",
      };
    });
  }

  // ----------------------------------------------------------------------
  // ローカル掲示板
  // ----------------------------------------------------------------------

  #pushLbbsPost(gameId: number, id: number, post: LbbsPost): void {
    const { repo, config } = this.#deps;
    const island = repo.findIsland(gameId, id);
    if (island === undefined) {
      throw new AppError("island_not_found");
    }
    const posts = [post, ...island.lbbs].slice(0, config.lbbsMax);
    repo.replaceLbbs(gameId, id, posts);
  }

  /**
   * Perl 版 Map.pm localBbsMain の移植。記帳はログイン必須 (14「認可ルール」節)。
   * actor 自身の島なら 'owner' として、他人の島なら 'visitor' として記帳する。
   * 表示名は actor.name (フォームで名前を受け取らない)。
   * tmp/16-season.md により現在のゲームが終了していても記帳できる (running は問わない)。
   * tmp/18-games.md により過去の (現在でない) ゲームには記帳できない。
   */
  postLbbs(
    actor: AuthUser | undefined,
    gameId: number,
    islandId: number,
    message: string,
  ): (OwnerPageVM | IslandPageVM) & { notice: string } {
    this.#requireCurrentGame(gameId);
    const { repo } = this.#deps;
    if (!this.#deps.siteSettings.get().useLbbs) {
      throw new AppError("lbbs_disabled");
    }
    const user = this.#requireLogin(actor);
    const island0 = repo.findIsland(gameId, islandId);
    if (island0 === undefined) {
      throw new AppError("island_not_found");
    }
    const cleanMessage = sanitizeText(message, MAX_LBBS_MESSAGE_LEN);
    if (cleanMessage === "") {
      throw new AppError("lbbs_empty");
    }
    this.#requireNgWordFree(cleanMessage);
    const isOwner = island0.ownerUserId === user.id;

    return repo.transaction(() => {
      const meta = repo.getMeta(gameId);
      this.#pushLbbsPost(gameId, islandId, {
        author: isOwner ? "owner" : "visitor",
        userId: user.id,
        name: user.name,
        message: cleanMessage,
        turn: meta.turn,
      });
      const notice = "記帳を行いました。";
      return isOwner
        ? { ...this.#buildOwnerPageVM(gameId, islandId, user.id), notice }
        : { ...this.#buildIslandPageVM(gameId, islandId), notice };
    });
  }

  /**
   * Perl 版 Map.pm localBbsMain (削除モード) の移植。actor 自身の島の記帳のみ削除できる。
   * postLbbs と同じく現在のゲームであれば running は問わない。
   */
  deleteLbbs(
    actor: AuthUser | undefined,
    gameId: number,
    number: number,
  ): OwnerPageVM & { notice: string } {
    this.#requireCurrentGame(gameId);
    const { repo, config } = this.#deps;
    if (!this.#deps.siteSettings.get().useLbbs) {
      throw new AppError("lbbs_disabled");
    }
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    if (!Number.isInteger(number) || number < 0 || number >= config.lbbsMax) {
      throw new AppError("invalid_input");
    }

    return repo.transaction(() => {
      const island = repo.findIsland(gameId, summary.id);
      if (island === undefined) {
        throw new AppError("island_not_found");
      }
      const posts = [...island.lbbs];
      if (number < posts.length) {
        posts.splice(number, 1);
      }
      repo.replaceLbbs(gameId, summary.id, posts);
      return {
        ...this.#buildOwnerPageVM(gameId, summary.id, user.id),
        notice: "記帳内容を削除しました。",
      };
    });
  }

  // ----------------------------------------------------------------------
  // 島の放棄 (tmp/19-abandon.md)
  // ----------------------------------------------------------------------

  /**
   * Perl 版には無い新規機能。19「ユースケース」節の移植。
   * 許可条件: 現在のゲーム、かつ終了していない (開始前は可)。自分の (放棄されていない) 島を
   * 持っていること。回数制限 (`config.maxAbandonsPerGame`) を超えると `abandon_limit` (409)。
   * 町のヘックスを荒地にして estimate、計画をすべて資金繰りに戻し `abandoned_at` を記録する。
   * 成功後はトップ画面 VM を通知付きで返す (web 層がそのままトップを描画する)。
   */
  abandonIsland(actor: AuthUser | undefined, gameId: number): TopPageVM & { notice: string } {
    const meta = this.#requireCurrentGame(gameId);
    if (isFinished(meta)) {
      throw new AppError("game_finished");
    }
    const { user, summary } = this.#requireOwnIsland(actor, gameId);
    const { repo, config } = this.#deps;

    return repo.transaction(() => {
      const count = repo.countAbandonments(gameId, user.id);
      if (count >= config.maxAbandonsPerGame) {
        throw new AppError("abandon_limit", "島の放棄は 1 ゲームにつき 3 回までです。");
      }

      const island = repo.findIsland(gameId, summary.id);
      if (island === undefined) {
        throw new AppError("island_not_found");
      }

      // 町 → 荒地。estimate で pop 等を再計算する (Town が無くなるため pop は 0 になる)。
      const { terrain } = island;
      for (let y = 0; y < terrain.size; y++) {
        for (let x = 0; x < terrain.size; x++) {
          if (terrain.get(x, y).kind === LandKind.Town) {
            terrain.setKind(x, y, LandKind.Waste, 0);
          }
        }
      }
      estimate(island);
      // 計画はすべて資金繰りに戻す。
      clearAll(island.commands, config.commandMax);
      const now = this.#deps.clock.now();
      island.abandonedAt = now;
      repo.updateIsland(gameId, island);
      repo.recordAbandonment(gameId, user.id, island.id, island.name, now);

      const log = new LogCollector(meta.turn);
      messages.logGiveupHistory(log, island.name);
      const { history } = log.flush();
      repo.appendHistory(gameId, history);

      const remaining = config.maxAbandonsPerGame - (count + 1);
      const notice = `${island.name}島を放棄しました。残り${remaining}回放棄できます。`;

      return { ...this.getTopPage(actor, gameId), notice };
    });
  }
}
