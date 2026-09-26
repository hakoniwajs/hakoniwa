// tmp/15-ng-words-and-mobile.md 「NG ワード」節の移植。
// naughty-words (LDNOOBW のリスト、CC-BY-4.0) の ja/en を同梱し、照合ロジックは自前で持つ。
// ランタイム非依存 (node:* に依存しない)。
import enWords from "naughty-words/en.json";
import jaWords from "naughty-words/ja.json";

/**
 * 誤検知が多い、または短すぎて汎用的すぎる英語エントリの除外リスト。
 * - "xx", "sm", "3p": 日常的な略語・記号列として使われることが多く、NG 語として
 *   意図せず一致してしまうため除外する。
 * - 2 文字以下の英語エントリ: 単語境界一致でも一般的な単語と衝突しやすいため除外する。
 */
const EXPLICIT_IGNORE_REASONS: Record<string, string> = {
  xx: "日常的に使われる記号列で誤検知が多いため。",
  sm: "日常的な略語として使われることが多いため。",
  "3p": "日常的な略語として使われることが多いため。",
};

function isTooShortEnglishEntry(word: string): boolean {
  return word.length <= 2;
}

/** 除外された NG ワードエントリの集合 (英語リストのみ対象)。 */
export const IGNORED_LIST_ENTRIES: ReadonlySet<string> = new Set([
  ...Object.keys(EXPLICIT_IGNORE_REASONS),
  ...(enWords as string[]).filter(isTooShortEnglishEntry),
]);

/**
 * 正規化: NFKC → 小文字化 → 空白・長音・中黒等の区切り記号を除去。
 * 15 の「照合ルール」1 の移植。
 */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・_\-ー]/gu, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ASCII 単語境界一致 (`(?<![a-z0-9])word(?![a-z0-9])`) の正規表現を作る。 */
function wordBoundaryRegExp(word: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(word)}(?![a-z0-9])`);
}

/**
 * 文中に NG ワードが含まれるか判定し、最初に見つかった語 (正規化前の元の語) を返す。
 * 見つからなければ undefined。
 *
 * - 日本語リスト (`ja`) の語: 正規化後の部分一致。
 * - 英語リスト (`en`) の語: 正規化後の ASCII 単語境界一致。
 * - `extra` (サイト設定の追加 NG ワード): 部分一致。
 *
 * 一致した語自体はログ用途を想定し、呼び出し側 (GameService) は利用者にこの語を見せない。
 */
export function findNgWord(text: string, extra: readonly string[] = []): string | undefined {
  const normalized = normalize(text);
  if (normalized === "") {
    return undefined;
  }

  for (const word of jaWords as string[]) {
    if (IGNORED_LIST_ENTRIES.has(word)) {
      continue;
    }
    const normalizedWord = normalize(word);
    if (normalizedWord !== "" && normalized.includes(normalizedWord)) {
      return word;
    }
  }

  for (const word of enWords as string[]) {
    if (IGNORED_LIST_ENTRIES.has(word)) {
      continue;
    }
    const normalizedWord = normalize(word);
    if (normalizedWord === "") {
      continue;
    }
    if (wordBoundaryRegExp(normalizedWord).test(normalized)) {
      return word;
    }
  }

  for (const word of extra) {
    const normalizedWord = normalize(word);
    if (normalizedWord !== "" && normalized.includes(normalizedWord)) {
      return word;
    }
  }

  return undefined;
}
