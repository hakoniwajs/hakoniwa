// tmp/15-ng-words-and-mobile.md 「NG ワード」節のテスト。
import { describe, expect, it } from "vite-plus/test";
import { IGNORED_LIST_ENTRIES, findNgWord } from "./ng-words.ts";

describe("findNgWord", () => {
  it("日本語 NG ワードは部分一致で検出する", () => {
    expect(findNgWord("これはエロティズムです")).toBeDefined();
  });

  it("NG ワードを含まない日本語文では undefined を返す", () => {
    expect(findNgWord("箱庭諸島はとても楽しいゲームです")).toBeUndefined();
  });

  it("英語 NG ワードは ASCII 単語境界一致で検出する (class は ass に当たらない)", () => {
    expect(findNgWord("this is a class")).toBeUndefined();
  });

  it("日本語文中の英単語も単語境界一致で検出する", () => {
    expect(findNgWord("これはassです")).toBeDefined();
  });

  it("NFKC 正規化により全角英字も検出する", () => {
    // 全角の ASS (エロティズムより短く分かりやすい語として ass を全角化して確認)。
    expect(findNgWord("これはＡＳＳです")).toBeDefined();
  });

  it("長音・中黒・空白等の区切り記号を除去してから照合する", () => {
    expect(findNgWord("エ・ロ・テ・ィ・ズ・ム")).toBeDefined();
  });

  it("extra に指定した語は部分一致で検出する", () => {
    expect(findNgWord("これはテスト用禁止語です", ["テスト用禁止語"])).toBe("テスト用禁止語");
  });

  it("extra を指定しなくても標準リストは検出される", () => {
    expect(findNgWord("これはエロティズムです", [])).toBeDefined();
  });

  it("除外リストの語 (xx, sm, 3p) は検出しない", () => {
    expect(findNgWord("xx")).toBeUndefined();
    expect(findNgWord("sm")).toBeUndefined();
    expect(findNgWord("3p")).toBeUndefined();
  });

  it("除外リストには 2 文字以下の英語エントリが含まれる", () => {
    for (const word of IGNORED_LIST_ENTRIES) {
      expect(word.length).toBeLessThanOrEqual(2);
    }
  });

  it("空文字は undefined を返す", () => {
    expect(findNgWord("")).toBeUndefined();
  });
});
