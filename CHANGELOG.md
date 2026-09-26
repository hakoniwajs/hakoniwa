# Changelog

## [v0.1.5](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.4...v0.1.5) - 2026-09-26

- テンプレート追従で npm registry への反映待ちがタイムアウトしないようにする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/23

## [v0.1.4](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.3...v0.1.4) - 2026-09-26

- Blume 製のドキュメントサイトを追加し GitHub Pages で公開する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/15
- Deploy to Cloudflare で入力を不要にする (AUTH_SECRET の自動生成と管理者の初期セットアップ) by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/16
- サイト設定を環境変数から管理画面に移す by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/17
- テンプレート追従で依存バージョンが "undefined" になる不具合を直す by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/18
- ドキュメントのトップページをサイドバーの無い独立したページにする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/20
- actions/checkout を v7.0.1 に更新する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/21
- 変更の経緯を説明するだけのコメントを整理する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/22

## [v0.1.3](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.2...v0.1.3) - 2026-09-26

- fix: npx / npm .bin 経由で hakoniwa CLI が起動しない問題を修正 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/9
- release 時に template-cloudflare の @hakoniwajs/* 依存を自動追従 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/11
- fix: テンプレート追従を secret 必須の無条件実行に変更 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/12
- mise-action を v4.3.0 に更新 (node24 ランタイム対応) by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/14

## [v0.1.2](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.1...v0.1.2) - 2026-09-26

- 依存更新・GitHub Actions の SHA pin・パッケージ README 追加 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/6
- typescript を 7.0.2 に更新 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/8

## [v0.1.1](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.0...v0.1.1) - 2026-09-26

- tagpr と npm publish を同一の release ワークフローに統合 by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/4

## [v0.1.0](https://github.com/hakoniwajs/hakoniwa/commits/v0.1.0) - 2026-09-26

- fix(game): 最終ターンで確実に停止させる (meta 読み直し + turn >= finalTurn 統一) by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/1
- npm パッケージ化: @hakoniwajs/{core,node,cloudflare} として公開可能にする by @devin-ai-integration[bot] in https://github.com/hakoniwajs/hakoniwa/pull/2
