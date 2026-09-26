// Perl 版 Main.pm の cgiInput (制御文字/カンマの除去) と cutColumn (文字数上限への切り詰め)、
// および newIslandMain/changeMain の島名禁止文字判定の移植。
// tmp/06-web-routes-and-views.md 「フォームのパースと検証」節。
// web 層 (Phase 3b) からも使えるよう app 層に置く。

/** 名前・コメント・掲示板の各文字数上限。 */
export const MAX_NAME_LEN = 32;
export const MAX_COMMENT_LEN = 80;
export const MAX_LBBS_NAME_LEN = 32;
export const MAX_LBBS_MESSAGE_LEN = 80;

/**
 * 制御文字 (0x00-0x1f) とカンマを除去する。
 * Perl 版 cgiInput は入力全体 (クエリ文字列) からこれを除去してから各フィールドに分割していた。
 */
export function stripControlAndComma(s: string): string {
  // eslint-disable-next-line no-control-regex -- Perl 版の制御文字除去 (\x00-\x1f) を再現するため。
  return s.replace(/[\x00-\x1f,]/g, "");
}

/**
 * 文字数 (コードポイント単位) を上限に切り詰める。
 * Perl 版 cutColumn はバイト数 (EUC-JP 2 バイト単位) で切り詰めていたが、
 * 06 の指示どおり文字数 (コードポイント) 基準にする。
 */
export function cutColumn(s: string, maxCodePoints: number): string {
  const chars = Array.from(s);
  if (chars.length <= maxCodePoints) {
    return s;
  }
  return chars.slice(0, maxCodePoints).join("");
}

/** 制御文字/カンマの除去 + 文字数上限への切り詰めをまとめて行う。 */
export function sanitizeText(s: string, maxCodePoints: number): string {
  return cutColumn(stripControlAndComma(s), maxCodePoints);
}

/**
 * 島名として使えない名前か判定する。
 * B20: Perl 版は新規作成時 (`,?()<>$` + `無人`) と変更時 (`,?()<>` + `無人`、`$` なし) で
 * 規則が微妙に異なっていたが、TS 版では両方ともこの規則に統一する。
 */
export function isBadIslandName(name: string): boolean {
  return /[,?()<>$]/.test(name) || name === "無人";
}
