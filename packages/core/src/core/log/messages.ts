// Perl 版 Turn.pm のログテンプレート群 (logNoMoney 〜 logPrize) の 1 対 1 移植。
// 文言・通常/遅延/機密/記録の種別は Perl 版と同一にする。
//
// 差異:
// - B3: logMsMonNoDamageS の標的側ログは Perl では logOut (通常) だが、
//   他のステルス系と同じく late (遅延) にする。
// - B25: logDoNothing は Perl でコメントアウトされているため、何も出力しない。
// - 単位表示 ($HunitMoney 等) を直接埋め込む関数だけ config を引数に取る
//   (logMsMonMoney, logMsBoatPeople, logSell, logMaizo)。他の関数は呼び出し側が
//   単位付きの文字列を組み立てて渡す (Perl 側でも doCommand 等で組み立てている)。
import type { GameConfig } from "../config.ts";
import * as markup from "./markup.ts";
import type { LogCollector } from "./collector.ts";

// ----------------------------------------------------------------------
// 資金/食料不足
// ----------------------------------------------------------------------

export function logNoMoney(log: LogCollector, id: number, name: string, comName: string): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、資金不足のため中止されました。`,
    id,
  );
}

export function logNoFood(log: LogCollector, id: number, name: string, comName: string): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、備蓄食料不足のため中止されました。`,
    id,
  );
}

// ----------------------------------------------------------------------
// 整地/埋め立て/掘削/伐採
// ----------------------------------------------------------------------

/** 対象地形の種類による失敗。kind は失敗理由の地形名。 */
export function logLandFail(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  kind: string,
  point: string,
): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、予定地の${markup.name(point)}が${markup.b(kind)}だったため中止されました。`,
    id,
  );
}

/** 周りに陸がなくて埋め立て失敗。 */
export function logNoLandAround(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  point: string,
): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、予定地の${markup.name(point)}の周辺に陸地がなかったため中止されました。`,
    id,
  );
}

/** 整地系成功。 */
export function logLandSuc(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  point: string,
): void {
  log.normal(`${markup.name(`${name}島${point}`)}で${markup.com(comName)}が行われました。`, id);
}

/** 油田発見。 */
export function logOilFound(
  log: LogCollector,
  id: number,
  name: string,
  point: string,
  comName: string,
  str: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}で${markup.b(str)}の予算をつぎ込んだ${markup.com(comName)}が行われ、${markup.b("油田が掘り当てられました")}。`,
    id,
  );
}

/** 油田発見ならず。 */
export function logOilFail(
  log: LogCollector,
  id: number,
  name: string,
  point: string,
  comName: string,
  str: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}で${markup.b(str)}の予算をつぎ込んだ${markup.com(comName)}が行われましたが、油田は見つかりませんでした。`,
    id,
  );
}

/** 油田からの収入。 */
export function logOilMoney(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
  str: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}から、${markup.b(str)}の収益が上がりました。`,
    id,
  );
}

/** 油田枯渇。 */
export function logOilEnd(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(`${markup.name(`${name}島${point}`)}の${markup.b(lName)}は枯渇したようです。`, id);
}

// ----------------------------------------------------------------------
// 防衛施設/記念碑/植林・基地/ハリボテ
// ----------------------------------------------------------------------

/** 防衛施設、自爆セット。 */
export function logBombSet(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}の${markup.b("自爆装置がセット")}されました。`,
    id,
  );
}

/** 防衛施設、自爆作動。 */
export function logBombFire(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}、${markup.disaster("自爆装置作動！！")}`,
    id,
  );
}

/** 記念碑、発射。 */
export function logMonFly(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}が${markup.b("轟音とともに飛び立ちました")}。`,
    id,
  );
}

/** 記念碑、落下。 */
export function logMonDamage(log: LogCollector, id: number, name: string, point: string): void {
  log.normal(
    `${markup.b("何かとてつもないもの")}が${markup.name(`${name}島${point}`)}地点に落下しました！！`,
    id,
  );
}

/** 植林 or ミサイル基地。 */
export function logPBSuc(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  point: string,
): void {
  log.secret(`${markup.name(`${name}島${point}`)}で${markup.com(comName)}が行われました。`, id);
  log.normal(`こころなしか、${markup.islandName(name)}の${markup.b("森")}が増えたようです。`, id);
}

/** ハリボテ。 */
export function logHariSuc(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  comName2: string,
  point: string,
): void {
  log.secret(`${markup.name(`${name}島${point}`)}で${markup.com(comName)}が行われました。`, id);
  logLandSuc(log, id, name, comName2, point);
}

// ----------------------------------------------------------------------
// ミサイル/怪獣派遣共通
// ----------------------------------------------------------------------

/** ミサイル撃とうとした (or 怪獣派遣しようとした) がターゲットがいない。 */
export function logMsNoTarget(log: LogCollector, id: number, name: string, comName: string): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、目標の島に人が見当たらないため中止されました。`,
    id,
  );
}

/** ミサイル撃とうとしたが基地がない。 */
export function logMsNoBase(log: LogCollector, id: number, name: string, comName: string): void {
  log.normal(
    `${markup.islandName(name)}で予定されていた${markup.com(comName)}は、${markup.b("ミサイル設備を保有していない")}ために実行できませんでした。`,
    id,
  );
}

/** ミサイル撃ったが範囲外。 */
export function logMsOut(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  point: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.b("領域外の海")}に落ちた模様です。`,
    id,
    tId,
  );
}

/** ステルスミサイル撃ったが範囲外。 */
export function logMsOutS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  point: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.b("領域外の海")}に落ちた模様です。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}へ向けて${markup.com(comName)}を行いましたが、${markup.b("領域外の海")}に落ちた模様です。`,
    tId,
  );
}

/** ミサイル撃ったが防衛施設でキャッチ。 */
export function logMsCaught(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}地点上空にて力場に捉えられ、${markup.b("空中爆発")}しました。`,
    id,
    tId,
  );
}

/** ステルスミサイル撃ったが防衛施設でキャッチ。 */
export function logMsCaughtS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}地点上空にて力場に捉えられ、${markup.b("空中爆発")}しました。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}へ向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}地点上空にて力場に捉えられ、${markup.b("空中爆発")}しました。`,
    tId,
  );
}

/** ミサイル撃ったが効果なし。 */
export function logMsNoDamage(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちたので被害がありませんでした。`,
    id,
    tId,
  );
}

/** ステルスミサイル撃ったが効果なし。 */
export function logMsNoDamageS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちたので被害がありませんでした。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちたので被害がありませんでした。`,
    tId,
  );
}

// ----------------------------------------------------------------------
// 陸地破壊弾
// ----------------------------------------------------------------------

/** 陸地破壊弾、山に命中。 */
export function logMsLDMountain(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に命中。${markup.b(tLname)}は消し飛び、荒地と化しました。`,
    id,
    tId,
  );
}

/** 陸地破壊弾、海底基地に命中。 */
export function logMsLDSbase(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}に着水後爆発、同地点にあった${markup.b(tLname)}は跡形もなく吹き飛びました。`,
    id,
    tId,
  );
}

/** 陸地破壊弾、怪獣に命中。 */
export function logMsLDMonster(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}に着弾し爆発。陸地は${markup.b(`怪獣${tLname}`)}もろとも水没しました。`,
    id,
    tId,
  );
}

/** 陸地破壊弾、浅瀬に命中。 */
export function logMsLDSea1(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に着弾。海底がえぐられました。`,
    id,
    tId,
  );
}

/** 陸地破壊弾、その他の地形に命中。 */
export function logMsLDLand(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に着弾。陸地は水没しました。`,
    id,
    tId,
  );
}

// ----------------------------------------------------------------------
// 通常ミサイル/ステルスミサイル 命中結果
// ----------------------------------------------------------------------

/** 通常ミサイル、荒地に着弾。 */
export function logMsWaste(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちました。`,
    id,
    tId,
  );
}

/** ステルスミサイル、荒地に着弾。 */
export function logMsWasteS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちました。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行いましたが、${markup.name(tPoint)}の${markup.b(tLname)}に落ちました。`,
    tId,
  );
}

/** 通常ミサイル、怪獣に命中、硬化中にて無傷。 */
export function logMsMonNoDamage(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中、しかし硬化状態だったため効果がありませんでした。`,
    id,
    tId,
  );
}

/**
 * ステルスミサイル、怪獣に命中、硬化中にて無傷。
 * B3: 標的側ログは Perl では logOut (通常) だが、他のステルス系と同じく late にする。
 */
export function logMsMonNoDamageS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中、しかし硬化状態だったため効果がありませんでした。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中、しかし硬化状態だったため効果がありませんでした。`,
    tId,
  );
}

/** 通常ミサイル、怪獣に命中、殺傷。 */
export function logMsMonKill(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は力尽き、倒れました。`,
    id,
    tId,
  );
}

/** ステルスミサイル、怪獣に命中、殺傷。 */
export function logMsMonKillS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は力尽き、倒れました。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は力尽き、倒れました。`,
    tId,
  );
}

/** 通常ミサイル、怪獣に命中、ダメージ。 */
export function logMsMonster(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は苦しそうに咆哮しました。`,
    id,
    tId,
  );
}

/** ステルスミサイル、怪獣に命中、ダメージ。 */
export function logMsMonsterS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は苦しそうに咆哮しました。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(`怪獣${tLname}`)}に命中。${markup.b(`怪獣${tLname}`)}は苦しそうに咆哮しました。`,
    tId,
  );
}

/** 怪獣の死体。 */
export function logMsMonMoney(
  log: LogCollector,
  tId: number,
  mName: string,
  value: number,
  config: GameConfig,
): void {
  log.normal(
    `${markup.b(`怪獣${mName}`)}の残骸には、${markup.b(`${value}${config.units.money}`)}の値が付きました。`,
    tId,
  );
}

/** 通常ミサイル通常地形に命中。 */
export function logMsNormal(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に命中、一帯が壊滅しました。`,
    id,
    tId,
  );
}

/** ステルスミサイル通常地形に命中。 */
export function logMsNormalS(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  tLname: string,
  point: string,
  tPoint: string,
): void {
  log.secret(
    `${markup.islandName(name)}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に命中、一帯が壊滅しました。`,
    id,
    tId,
  );
  log.late(
    `${markup.b("何者か")}が${markup.name(`${tName}島${point}`)}地点に向けて${markup.com(comName)}を行い、${markup.name(tPoint)}の${markup.b(tLname)}に命中、一帯が壊滅しました。`,
    tId,
  );
}

/** ミサイル難民到着。 */
export function logMsBoatPeople(
  log: LogCollector,
  id: number,
  name: string,
  achive: number,
  config: GameConfig,
): void {
  log.normal(
    `${markup.islandName(name)}にどこからともなく${markup.b(`${achive}${config.units.pop}もの難民`)}が漂着しました。${markup.islandName(name)}は快く受け入れたようです。`,
    id,
  );
}

/** 怪獣派遣。 */
export function logMonsSend(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.b("人造怪獣")}を建造。${markup.islandName(tName)}へ送りこみました。`,
    id,
    tId,
  );
}

/**
 * 資金繰り。
 * B25: Perl 版はコメントアウトされているため、呼び出し互換のためだけに残し何も出力しない。
 */
export function logDoNothing(
  _log: LogCollector,
  _id: number,
  _name: string,
  _comName: string,
): void {
  // 何もしない (Perl 版でもコメントアウトされている)。
}

/** 輸出。 */
export function logSell(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  value: number,
  config: GameConfig,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.b(`${value}${config.units.food}`)}の${markup.com(comName)}を行いました。`,
    id,
  );
}

/** 援助。 */
export function logAid(
  log: LogCollector,
  id: number,
  tId: number,
  name: string,
  tName: string,
  comName: string,
  str: string,
): void {
  log.normal(
    `${markup.islandName(name)}が${markup.islandName(tName)}へ${markup.b(str)}の${markup.com(comName)}を行いました。`,
    id,
    tId,
  );
}

/** 誘致活動。 */
export function logPropaganda(log: LogCollector, id: number, name: string, comName: string): void {
  log.normal(`${markup.islandName(name)}で${markup.com(comName)}が行われました。`, id);
}

/**
 * 放棄 (通常ログのみ)。Perl 由来の自動放棄 (計画コマンド「島の放棄」kind 46 の実行。
 * `turn/command-misc.ts` の `doGiveup`) が使う。
 */
export function logGiveupNotice(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}は放棄され、${markup.b("無人島")}になりました。`, id);
}

/**
 * 放棄の記録 (history のみ)。tmp/19-abandon.md「ユースケース」節: `GameService.abandonIsland`
 * は放棄した時点で history にこの文言を追記する。ターン末の除去時は通常ログ
 * (`logGiveupNotice`) だけを出し、history はここ (放棄した時点) の1回だけにする (二重記録の防止)。
 */
export function logGiveupHistory(log: LogCollector, name: string): void {
  log.history(`${markup.islandName(name)}、放棄され${markup.b("無人島")}となる。`);
}

/** 放棄 (通常ログ + history)。Perl 由来の自動放棄 (`doGiveup`) が使う。 */
export function logGiveup(log: LogCollector, id: number, name: string): void {
  logGiveupNotice(log, id, name);
  logGiveupHistory(log, name);
}

/** 死滅。 */
export function logDead(log: LogCollector, id: number, name: string): void {
  log.normal(
    `${markup.islandName(name)}から人がいなくなり、${markup.b("無人島")}になりました。`,
    id,
  );
  log.history(`${markup.islandName(name)}、人がいなくなり${markup.b("無人島")}となる。`);
}

/** 発見。 */
export function logDiscover(log: LogCollector, name: string): void {
  log.history(`${markup.islandName(name)}が発見される。`);
}

/** 名前の変更。 */
export function logChangeName(log: LogCollector, name1: string, name2: string): void {
  log.history(`${markup.islandName(name1)}、名称を${markup.islandName(name2)}に変更する。`);
}

/** 飢餓。 */
export function logStarve(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}の${markup.disaster("食料が不足")}しています！！`, id);
}

/** 怪獣現る。 */
export function logMonsCome(
  log: LogCollector,
  id: number,
  name: string,
  mName: string,
  point: string,
  lName: string,
): void {
  log.normal(
    `${markup.islandName(name)}に${markup.b(`怪獣${mName}`)}出現！！${markup.name(point)}の${markup.b(lName)}が踏み荒らされました。`,
    id,
  );
}

/** 怪獣動く。 */
export function logMonsMove(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
  mName: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}が${markup.b(`怪獣${mName}`)}に踏み荒らされました。`,
    id,
  );
}

/** 怪獣、防衛施設を踏む。 */
export function logMonsMoveDefence(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
  mName: string,
): void {
  log.normal(
    `${markup.b(`怪獣${mName}`)}が${markup.name(`${name}島${point}`)}の${markup.b(lName)}へ到達、${markup.b(`${lName}の自爆装置が作動！！`)}`,
    id,
  );
}

/** 火災。 */
export function logFire(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}が${markup.disaster("火災")}により壊滅しました。`,
    id,
  );
}

/** 埋蔵金。 */
export function logMaizo(
  log: LogCollector,
  id: number,
  name: string,
  comName: string,
  value: number,
  config: GameConfig,
): void {
  log.normal(
    `${markup.islandName(name)}での${markup.com(comName)}中に、${markup.b(`${value}${config.units.money}もの埋蔵金`)}が発見されました。`,
    id,
  );
}

// ----------------------------------------------------------------------
// 天災
// ----------------------------------------------------------------------

/** 地震発生。 */
export function logEarthquake(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}で大規模な${markup.disaster("地震")}が発生！！`, id);
}

/** 地震被害。 */
export function logEQDamage(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}は${markup.disaster("地震")}により壊滅しました。`,
    id,
  );
}

/** 食料不足被害。 */
export function logSvDamage(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}に${markup.b("食料を求めて住民が殺到")}。${markup.b(lName)}は壊滅しました。`,
    id,
  );
}

/** 津波発生。 */
export function logTsunami(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}付近で${markup.disaster("津波")}発生！！`, id);
}

/** 津波被害。 */
export function logTsunamiDamage(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}は${markup.disaster("津波")}により崩壊しました。`,
    id,
  );
}

/** 台風発生。 */
export function logTyphoon(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}に${markup.disaster("台風")}上陸！！`, id);
}

/** 台風被害。 */
export function logTyphoonDamage(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}は${markup.disaster("台風")}で飛ばされました。`,
    id,
  );
}

/** 隕石、海。 */
export function logMeteoSea(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}に${markup.disaster("隕石")}が落下しました。`,
    id,
  );
}

/** 隕石、山。 */
export function logMeteoMountain(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}に${markup.disaster("隕石")}が落下、${markup.b(lName)}は消し飛びました。`,
    id,
  );
}

/** 隕石、海底基地。 */
export function logMeteoSbase(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}に${markup.disaster("隕石")}が落下、${markup.b(lName)}は崩壊しました。`,
    id,
  );
}

/** 隕石、怪獣。 */
export function logMeteoMonster(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.b(`怪獣${lName}`)}がいた${markup.name(`${name}島${point}`)}地点に${markup.disaster("隕石")}が落下、陸地は${markup.b(`怪獣${lName}`)}もろとも水没しました。`,
    id,
  );
}

/** 隕石、浅瀬。 */
export function logMeteoSea1(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点に${markup.disaster("隕石")}が落下、海底がえぐられました。`,
    id,
  );
}

/** 隕石、その他。 */
export function logMeteoNormal(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点の${markup.b(lName)}に${markup.disaster("隕石")}が落下、一帯が水没しました。`,
    id,
  );
}

/** 巨大隕石。 */
export function logHugeMeteo(log: LogCollector, id: number, name: string, point: string): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点に${markup.disaster("巨大隕石")}が落下！！`,
    id,
  );
}

/** 噴火。 */
export function logEruption(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点で${markup.disaster("火山が噴火")}、${markup.b("山")}が出来ました。`,
    id,
  );
}

/** 噴火、浅瀬。 */
export function logEruptionSea1(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点の${markup.b(lName)}は、${markup.disaster("噴火")}の影響で陸地になりました。`,
    id,
  );
}

/** 噴火、海 or 海基。 */
export function logEruptionSea(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点の${markup.b(lName)}は、${markup.disaster("噴火")}の影響で海底が隆起、浅瀬になりました。`,
    id,
  );
}

/** 噴火、その他。 */
export function logEruptionNormal(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}地点の${markup.b(lName)}は、${markup.disaster("噴火")}の影響で壊滅しました。`,
    id,
  );
}

/** 地盤沈下発生。 */
export function logFalldown(log: LogCollector, id: number, name: string): void {
  log.normal(`${markup.islandName(name)}で${markup.disaster("地盤沈下")}が発生しました！！`, id);
}

/** 地盤沈下被害。 */
export function logFalldownLand(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(`${markup.name(`${name}島${point}`)}の${markup.b(lName)}は海の中へ沈みました。`, id);
}

// ----------------------------------------------------------------------
// 広域被害 (wideDamage)
// ----------------------------------------------------------------------

/** 広域被害、水没。 */
export function logWideDamageSea(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}は${markup.b("水没")}しました。`,
    id,
  );
}

/** 広域被害、海の建設 (海底基地/油田の消滅)。 */
export function logWideDamageSea2(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(`${markup.name(`${name}島${point}`)}の${markup.b(lName)}は跡形もなくなりました。`, id);
}

/** 広域被害、怪獣水没。 */
export function logWideDamageMonsterSea(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の陸地は${markup.b(`怪獣${lName}`)}もろとも水没しました。`,
    id,
  );
}

/** 広域被害、怪獣。 */
export function logWideDamageMonster(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(`怪獣${lName}`)}は消し飛びました。`,
    id,
  );
}

/** 広域被害、荒地。 */
export function logWideDamageWaste(
  log: LogCollector,
  id: number,
  name: string,
  lName: string,
  point: string,
): void {
  log.normal(
    `${markup.name(`${name}島${point}`)}の${markup.b(lName)}は一瞬にして${markup.b("荒地")}と化しました。`,
    id,
  );
}

// ----------------------------------------------------------------------
// 受賞
// ----------------------------------------------------------------------

/** 受賞。 */
export function logPrize(log: LogCollector, id: number, name: string, pName: string): void {
  log.normal(`${markup.islandName(name)}が${markup.b(pName)}を受賞しました。`, id);
  log.history(`${markup.islandName(name)}、${markup.b(pName)}を受賞`);
}
