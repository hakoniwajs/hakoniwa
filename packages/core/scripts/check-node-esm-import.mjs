// 公開物 (dist) を Node の ESM から直接 import できることの回帰チェック。
// naughty-words の JSON を属性なしで import していると、ここで
// `needs an import attribute of "type: json"` になる。
// Vitest は Vite 経由で JSON をインライン化するため、この失敗を拾えない。

const { findNgWord } = await import("../dist/index.js");

if (typeof findNgWord !== "function") {
  throw new Error("dist/index.js did not export findNgWord");
}

if (findNgWord("これはエロティズムです") === undefined) {
  throw new Error("findNgWord did not see the Japanese word list (JSON import failed silently)");
}

console.log("node esm import ok");
