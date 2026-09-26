# @hakoniwajs/core

[箱庭諸島２ (TypeScript 版)](https://github.com/hakoniwajs/hakoniwa) のランタイム非依存コアです。ゲームロジック、ユースケース、SQLite 用ストレージ抽象、Hono + hono/jsx の画面 (Web アプリ本体)、OGP 画像の描画、静的アセット (`public/`) を含みます。

通常はこのパッケージを直接使うのではなく、ランタイム別の Adapter 経由で利用します:

- Node.js で動かす → [`@hakoniwajs/node`](https://www.npmjs.com/package/@hakoniwajs/node)
- Cloudflare Workers で動かす → [`@hakoniwajs/cloudflare`](https://www.npmjs.com/package/@hakoniwajs/cloudflare)

独自ランタイムへ組み込む場合は `createApp` / `WebDeps` / `composeNode` に相当する組み立て (`bootstrap/`) と `SqlDriver` などのストレージ実装を用意してください。詳しくは [開発者向けドキュメント](https://hakoniwajs.github.io/hakoniwa/development/) を参照してください。

## License

オリジナルの利用条件に従います ([LICENSE](https://github.com/hakoniwajs/hakoniwa/blob/main/LICENSE))。画面最上部にオリジナルへのリンクを残す、同条件での再配布、同梱画像 (小川克人氏の著作物) の商用利用は不可、など。
