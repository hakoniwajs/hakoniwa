# @hakoniwajs/cloudflare

[箱庭諸島２ (TypeScript 版)](https://github.com/hakoniwajs/hakoniwa) の Cloudflare Workers Adapter です。Durable Objects (SQLite) 版の Worker エントリと DO クラスを提供します。

テンプレートリポジトリ [hakoniwajs/template-cloudflare](https://github.com/hakoniwajs/template-cloudflare) を使うのが一番簡単です (Deploy to Cloudflare ボタン対応)。

## 使い方

```console
$ npm install @hakoniwajs/cloudflare
```

`src/worker.ts`:

```ts
import { createWorker } from "@hakoniwajs/cloudflare";

// wrangler.jsonc の durable_objects.class_name で HakoniwaGame を解決するため
// このファイルから再エクスポートする必要がある
export { HakoniwaGame } from "@hakoniwajs/cloudflare";

export default createWorker();
```

`wrangler.jsonc` の最小構成 (完全な設定例はテンプレートを参照):

```jsonc
{
  "name": "hakoniwa",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-22",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./node_modules/@hakoniwajs/core/public" },
  "durable_objects": {
    "bindings": [{ "name": "GAME", "class_name": "HakoniwaGame" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HakoniwaGame"] }],
  "triggers": { "crons": ["*/15 * * * *"] },
  "vars": { "HAKONIWA_DEV_LOGIN": "false" },
}
```

`HAKONIWA_AUTH_SECRET` などの秘密情報は `wrangler secret put <NAME>` で登録してください。設定項目の一覧は [環境変数一覧](https://hakoniwajs.github.io/hakoniwa/setup/environment-variables/) を参照してください。

## API

- `createWorker(options?)` — `fetch`/`scheduled` を持つ Worker オブジェクトを返します。`options.doBinding` で DO バインディング名を `GAME` 以外に変更できます。
- `HakoniwaGame` — Durable Object クラス (上記の通り再エクスポート必須)。

## License

オリジナルの利用条件に従います ([LICENSE](https://github.com/hakoniwajs/hakoniwa/blob/main/LICENSE))。同梱画像の商用利用はできません。
