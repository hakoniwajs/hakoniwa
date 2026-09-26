// public/remaining.js (残り時間をブラウザで表示する補助スクリプト) が、サーバー側の
// formatRemaining (app/format.ts) と同じ表記を出すことの確認。スクリプトを最小限の
// document のスタブの上で実行する。
import { describe, expect, it } from "vitest";
import remainingScript from "../../public/remaining.js?raw";
import { formatRemaining } from "../app/format.ts";

interface FakeElement {
  attribute: string | null;
  textContent: string;
  getAttribute(name: string): string | null;
}

function fakeElement(attribute: string | null): FakeElement {
  return {
    attribute,
    textContent: "",
    getAttribute(name: string) {
      return name === "data-remaining-until" ? this.attribute : null;
    },
  };
}

/** スクリプトを実行し、各要素に表示された文字列を返す。 */
function runScript(nowSec: number, attributes: (string | null)[]): string[] {
  const elements = attributes.map(fakeElement);
  const document = {
    querySelectorAll(selector: string) {
      expect(selector).toBe("[data-remaining-until]");
      return elements;
    },
  };
  const FakeDate = { now: () => nowSec * 1000 };
  const intervals: unknown[] = [];
  const setInterval = (fn: unknown) => {
    intervals.push(fn);
    return 0;
  };
  // oxlint-disable-next-line typescript/no-implied-eval -- テスト対象のブラウザ向けスクリプトをそのまま実行する
  const run = new Function("document", "Date", "setInterval", remainingScript) as (
    document: unknown,
    date: unknown,
    setInterval: unknown,
  ) => void;
  run(document, FakeDate, setInterval);
  expect(intervals).toHaveLength(1);
  return elements.map((element) => element.textContent);
}

describe("public/remaining.js", () => {
  it("formatRemaining と同じ表記で「 (あと …)」を表示する", () => {
    const now = 1_700_000_000;
    const diffs = [-10, 0, 59, 60, 61, 3599, 3600, 3660, 21600, 86399, 86400, 86700, 200_000];
    const texts = runScript(
      now,
      diffs.map((diff) => String(now + diff)),
    );
    expect(texts).toEqual(diffs.map((diff) => ` (${formatRemaining(diff)})`));
  });

  it("数値でない属性は無視する", () => {
    expect(runScript(1_700_000_000, ["abc", null, ""])).toEqual(["", "", ""]);
  });
});
