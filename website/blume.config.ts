import { defineConfig } from "blume";

// 箱庭諸島２ (TypeScript 版) のドキュメントサイト。GitHub Pages
// (https://hakoniwajs.github.io/hakoniwa/) に静的ビルドを置く (.github/workflows/docs.yml)。
export default defineConfig({
  title: "箱庭諸島２ TypeScript 版",
  description:
    "懐かしの Web ブラウザゲーム「箱庭諸島２」を TypeScript で書き直し、Cloudflare Workers にワンクリックで設置できるようにしたものです。",
  i18n: {
    defaultLocale: "ja",
    locales: [{ code: "ja", label: "日本語" }],
  },
  theme: {
    accent: "teal",
    mode: "system",
  },
  github: {
    owner: "hakoniwajs",
    repo: "hakoniwa",
    dir: "website",
  },
  // 箱庭諸島２の画面に合わせたものではない Blume 既定の評価フォームは不要。
  feedback: false,
  deployment: {
    site: "https://hakoniwajs.github.io",
    base: "/hakoniwa",
  },
});
