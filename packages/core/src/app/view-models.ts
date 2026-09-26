// 画面向け DTO。HTML は含めない (描画は Phase 3b の web/views が行う)。
// tmp/06-web-routes-and-views.md 「画面」節、Perl 版 Top.pm / Map.pm の各 temp* 関数が
// 表示していた情報を構造化したもの。
import type { AuthUser } from "./auth.ts";
import type { GameStatus, GameSummary, UserPrefs } from "./ports.ts";
import type { SeasonVM } from "./season.ts";
import type { GameConfig } from "../core/config.ts";
import type { FormattedCommand } from "../core/commands/format.ts";
import { OGP_HEIGHT, OGP_WIDTH } from "../ogp/render.ts";
import type { FlagPrizeView, KilledMonstersView } from "../core/prize.ts";
import type { Command, HistoryEntry, LbbsPost, LogEntry, Terrain } from "../core/types.ts";

/**
 * 資金の表示方法。Perl 版 aboutMoney / hideMoneyMode の移植。
 * - hidden: hideMoneyMode 0 かつ観光者 (欄自体を表示しない)
 * - exact: hideMoneyMode 1、または開発画面 (島主本人)
 * - about: hideMoneyMode 2 (観光者向け概算表示)
 */
export interface MoneyDisplay {
  mode: "hidden" | "exact" | "about";
  value?: number;
  text?: string;
}

/** Perl 版 aboutMoney の移植。 */
export function aboutMoney(money: number, unit: string): string {
  if (money < 500) {
    return `推定500${unit}未満`;
  }
  const thousands = Math.floor((money + 500) / 1000);
  return `推定${thousands}000${unit}`;
}

/** hideMoneyMode と観光/開発の別から MoneyDisplay を組み立てる。 */
export function buildMoneyDisplay(
  money: number,
  config: GameConfig,
  isOwner: boolean,
): MoneyDisplay {
  if (config.hideMoneyMode === 1 || isOwner) {
    return { mode: "exact", value: money };
  }
  if (config.hideMoneyMode === 2) {
    return { mode: "about", text: aboutMoney(money, config.units.money) };
  }
  return { mode: "hidden" };
}

/** 受賞状況の表示用データ。core/prize.ts の各関数の結果をまとめたもの。 */
export interface PrizeVM {
  turnPrizes: number[];
  flagPrizes: FlagPrizeView[];
  killedMonsters: KilledMonstersView;
}

/** トップ画面の島 1 行分。Perl 版 Top.pm tempTopPage の表の 1 行に相当。 */
export interface IslandRowVM {
  id: number;
  name: string;
  /** 1 始まり。 */
  rank: number;
  absent: number;
  pop: number;
  area: number;
  food: number;
  farm: number;
  factory: number;
  mountain: number;
  moneyDisplay: MoneyDisplay;
  prize: PrizeVM;
  comment: string;
  /** 放棄済みか。tmp/19-abandon.md「表示」節: 順位表で名前に「(放棄)」を付ける。 */
  abandoned: boolean;
}

/** ログイン状態と自分の島の有無。14「ルート」節の GET / 表示の出し分けに使う。 */
export interface ViewerVM {
  user?: AuthUser;
  hasIsland: boolean;
}

/**
 * 画面に表示するゲームの識別情報。tmp/18-games.md「GameService」節:
 * TopPageVM/OwnerPageVM/IslandPageVM に含める `game` フィールド。
 */
export interface GameHeaderVM {
  id: number;
  name: string;
  status: GameStatus;
  /** 現在のゲーム (`repo.getCurrentGameId()`) と一致するか。過去のゲームなら false。 */
  isCurrent: boolean;
}

/** トップ画面全体。 */
export interface TopPageVM {
  turn: number;
  islands: IslandRowVM[];
  /** 島の数が上限未満か (新規作成フォームを出すかどうか)。現在のゲーム以外は常に false。 */
  canCreate: boolean;
  logs: LogEntry[];
  history: HistoryEntry[];
  debug: boolean;
  viewer: ViewerVM;
  /** 開始時刻・最終ターン・状態 (開始前/進行中/終了)。tmp/16-season.md。 */
  season: SeasonVM;
  /** tmp/18-games.md。 */
  game: GameHeaderVM;
}

/** 観光/開発/新規発見画面で共通の島情報。Perl 版 islandInfo + islandMap の情報部分。 */
export interface IslandDetailVM {
  id: number;
  name: string;
  /** 1 始まり。 */
  rank: number;
  /** 現在のターン数。IslandMap の怪獣硬化判定 (isHardened) に必要 (web 層で追加)。 */
  turn: number;
  absent: number;
  pop: number;
  area: number;
  food: number;
  farm: number;
  factory: number;
  mountain: number;
  comment: string;
  prize: PrizeVM;
  terrain: Terrain;
}

/** OGP 画像・メタタグ用の情報。tmp/17-ogp.md 「メタタグ」節。 */
export interface IslandOgpVM {
  // og:title (「<島名>島 - <サイトタイトル>」) はサイトタイトルが管理画面から変わるため VM には
  // 持たず、描画時に views/island.tsx の IslandOgpHead が組み立てる。
  /** og:description。「ターンN / 人口 X人・面積 Y万坪・順位 Z位」。 */
  description: string;
  /**
   * `/games/:gameId/islands/:id/ogp.png?turn=N` (相対パス)。tmp/18-games.md「ルート」節。
   * 絶対 URL 化は web 層 (views/island.tsx) が行う。
   */
  imagePath: string;
  width: number;
  height: number;
}

/** IslandDetailVM から IslandOgpVM を組み立てる。 */
export function buildIslandOgpVM(
  detail: Pick<IslandDetailVM, "id" | "name" | "rank" | "turn" | "pop" | "area">,
  gameId: number,
  config: GameConfig,
): IslandOgpVM {
  return {
    description:
      `ターン${detail.turn} / 人口 ${detail.pop}${config.units.pop}・` +
      `面積 ${detail.area}${config.units.area}・順位 ${detail.rank}位`,
    imagePath: `/games/${gameId}/islands/${detail.id}/ogp.png?turn=${detail.turn}`,
    width: OGP_WIDTH,
    height: OGP_HEIGHT,
  };
}

/** 観光画面。Perl 版 printIslandMain。 */
export interface IslandPageVM extends IslandDetailVM {
  moneyDisplay: MoneyDisplay;
  lbbs: LbbsPost[];
  /** mode 0 (機密除外)。 */
  logs: LogEntry[];
  /** tmp/17-ogp.md。GET /islands/:id の OGP メタタグ用。 */
  ogp: IslandOgpVM;
  /** tmp/18-games.md。 */
  game: GameHeaderVM;
}

/** 開発画面。Perl 版 ownerMain。島主本人向けなので資金は実値。 */
export interface OwnerPageVM extends IslandDetailVM {
  money: number;
  commands: FormattedCommand[];
  /**
   * 整形前のコマンド一覧 (web 層で追加)。IslandMap の座標付き計画オーバーレイ (Perl 版 comStr) は
   * x/y が必要だが FormattedCommand は文字列化済みで持たないため、別途生の Command 配列を持たせる。
   */
  rawCommands: Command[];
  lbbs: LbbsPost[];
  /** mode 1 (本人の機密ログを含む)。 */
  logs: LogEntry[];
  /** 計画登録フォームの初期値 (user_prefs)。未保存なら空オブジェクト。 */
  defaults: UserPrefs;
  /** 開始時刻・最終ターン・状態 (開始前/進行中/終了)。tmp/16-season.md。終了後はフォームを隠す。 */
  season: SeasonVM;
  /** 島の放棄。tmp/19-abandon.md「ユースケース」節: 残り放棄可能回数。 */
  abandon: { remaining: number };
  /** tmp/18-games.md。過去のゲーム (isCurrent=false) は読み取り専用として扱う。 */
  game: GameHeaderVM;
}

/** 新規発見画面。Perl 版 newIslandMain (tempNewIslandHead + islandInfo + islandMap(owner))。 */
export interface NewIslandVM extends IslandDetailVM {
  money: number;
}

/** フォームの島セレクト用。 */
export interface IslandSelectVM {
  id: number;
  name: string;
}

/** GET /games (ゲーム一覧) の 1 行。tmp/18-games.md「表示」節: 名前/開始/終了/ターン数/島数/状態。 */
export interface GameListItemVM extends GameSummary {
  isCurrent: boolean;
}
