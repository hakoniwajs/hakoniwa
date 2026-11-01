# Changelog

## [v0.1.7](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.6...v0.1.7) - 2026-11-01

- Fix Node ESM import of published @hakoniwajs/core by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/44

## [v0.1.6](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.5...v0.1.6) - 2026-11-01

- hako.session_data が分割されず 4096 バイト未満であることをテストする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/34
- Workers Cache 有効時は静的アセットも課金対象になることを書く by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/33
- ドキュメントから以前のバージョンに関する言及を削る by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/36
- キャッシュ説明で wrangler.jsonc の追加設定は不要と明記する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/37
- メールログインの baseURL を Cloudflare はリクエスト origin、Node は HAKONIWA_BASE_URL にする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/38
- server.ts と dev.ts も HAKONIWA_BASE_URL 未設定なら一行で終了する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/39
- Fail the Vite dev server at startup when HAKONIWA_BASE_URL is unset by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/40
- Patch dependency advisories from pnpm and website audits by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/41
- Make HAKONIWA_BASE_URL optional when Node listens on loopback by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/42
- Clear remaining dev-only audit advisories with major upgrades by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/43

## [v0.1.5](https://github.com/hakoniwajs/hakoniwa/compare/v0.1.4...v0.1.5) - 2026-10-24

- テンプレート追従で npm registry への反映待ちがタイムアウトしないようにする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/23
- Worker を Gateway と Workers Cache 用の CachedPages エントリポイントに分割する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/26
- 未ログインの HTML を Workers Cache にキャッシュし、KV スナップショットを無くす by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/27
- ログイン中のページもセッションごとに Workers Cache にキャッシュする by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/28
- 稀なイベントで Workers Cache を purge する by @syumai in https://github.com/hakoniwajs/hakoniwa/pull/29

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
