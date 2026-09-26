// Perl 版 Const.pm の「設定値」部分の移植。
// 見た目関連 (FONT タグ、BGCOLOR 等) はここに含めない (CSS クラスに置き換える)。

/** ゲームの単位表示。 */
export interface GameUnits {
  money: string;
  food: string;
  pop: string;
  area: string;
  tree: string;
}

/** 災害発生確率 (0.1% 単位)。怪獣関連の基準値も含む。 */
export interface DisasterConfig {
  earthquake: number;
  tsunami: number;
  typhoon: number;
  meteo: number;
  hugeMeteo: number;
  eruption: number;
  fire: number;
  maizo: number;
  /** 地盤沈下の安全限界の広さ (Hex 数)。 */
  fallBorder: number;
  /** 安全限界を超えた場合の地盤沈下確率。 */
  falldown: number;
  /** 怪獣レベル1の人口基準。 */
  monsBorder1: number;
  /** 怪獣レベル2の人口基準。 */
  monsBorder2: number;
  /** 怪獣レベル3の人口基準。 */
  monsBorder3: number;
  /** 単位面積あたりの怪獣出現率 (0.01% 単位)。 */
  monster: number;
}

/** 油田の設定。 */
export interface OilConfig {
  money: number;
  ratio: number;
}

// サイト情報 (タイトル・フッタ)・ローカル掲示板の有無・タイムゾーン・追加 NG ワードは
// 管理画面から変更できるサイト設定 (app/site-settings.ts) に移した。
export interface GameConfig {
  // 進行
  /**
   * 1ターンが何秒か。tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節: 初期化後は
   * `GameMeta.unitTimeSec` (DB の値) が実際のターン進行に使われ、この値は「新しいデータを
   * 作るときの既定値」としてのみ使われる。
   */
  unitTimeSec: number;
  /** 島の最大数。 */
  maxIslands: number;
  /** トップページに表示するログのターン数。 */
  topLogTurns: number;
  /** ログファイル保持ターン数。 */
  logKeepTurns: number;
  /** バックアップを何ターンおきに取るか。 */
  backupEveryTurns: number;
  /** バックアップを何回分残すか。 */
  backupKeep: number;
  /** 発見ログ保持行数。 */
  historyMax: number;
  /** 放棄コマンド自動入力ターン数。 */
  giveupTurns: number;
  /** 島の放棄 (`GameService.abandonIsland`) の 1 ゲームあたりの上限回数。tmp/19-abandon.md。 */
  maxAbandonsPerGame: number;
  /** コマンド入力限界数。 */
  commandMax: number;
  /** ローカル掲示板行数。 */
  lbbsMax: number;
  /** 島の大きさ (変更非推奨)。 */
  islandSize: number;
  /** 他人から資金を見えなくするか (0: 見えない, 1: 見える, 2: 100の位で四捨五入)。 */
  hideMoneyMode: 0 | 1 | 2;
  debug: boolean;
  /** 1回の判定で進める最大ターン数 (新規。既定 1 = Perl 互換)。 */
  maxCatchUpTurns: number;

  // 経済
  initialMoney: number;
  initialFood: number;
  units: GameUnits;
  /** 木の単位当たりの売値。 */
  treeValue: number;
  /** 名前変更のコスト。 */
  costChangeName: number;
  /** 人口1単位あたりの食料消費量。 */
  eatenFood: number;

  // 基地
  /** 経験値の最大値 (ただし最大でも255まで)。 */
  maxExpPoint: number;
  /** ミサイル基地レベルの最大値。 */
  maxBaseLevel: number;
  /** 海底基地レベルの最大値。 */
  maxSBaseLevel: number;
  /** ミサイル基地: 経験値がいくつでレベルアップか。 */
  baseLevelUp: number[];
  /** 海底基地: 経験値がいくつでレベルアップか。 */
  sBaseLevelUp: number[];
  /** 防衛施設: 怪獣に踏まれた時自爆するか。 */
  dBaseAuto: boolean;

  // 災害
  disaster: DisasterConfig;
  /** 各基準において出てくる怪獣の番号の最大値 [レベル1, レベル2, レベル3]。 */
  monsterLevel: [number, number, number];
  oil: OilConfig;
  /** ターン杯を何ターン毎に出すか。 */
  turnPrizeUnit: number;
}

export const defaultConfig: GameConfig = {
  unitTimeSec: 21600,
  maxIslands: 30,
  topLogTurns: 1,
  logKeepTurns: 8,
  backupEveryTurns: 12,
  backupKeep: 4,
  historyMax: 10,
  giveupTurns: 28,
  maxAbandonsPerGame: 3,
  commandMax: 20,
  lbbsMax: 10,
  islandSize: 12,
  hideMoneyMode: 2,
  debug: false,
  maxCatchUpTurns: 1,

  initialMoney: 100,
  initialFood: 100,
  units: {
    money: "億円",
    food: "00トン",
    pop: "00人",
    area: "00万坪",
    tree: "00本",
  },
  treeValue: 5,
  costChangeName: 500,
  eatenFood: 0.2,

  maxExpPoint: 200,
  maxBaseLevel: 5,
  maxSBaseLevel: 3,
  baseLevelUp: [20, 60, 120, 200],
  sBaseLevelUp: [50, 200],
  dBaseAuto: true,

  disaster: {
    earthquake: 5,
    tsunami: 15,
    typhoon: 20,
    meteo: 15,
    hugeMeteo: 5,
    eruption: 10,
    fire: 10,
    maizo: 10,
    fallBorder: 90,
    falldown: 30,
    monsBorder1: 1000,
    monsBorder2: 2500,
    monsBorder3: 4000,
    monster: 3,
  },
  monsterLevel: [2, 5, 7],
  oil: {
    money: 1000,
    ratio: 40,
  },
  turnPrizeUnit: 100,
};
