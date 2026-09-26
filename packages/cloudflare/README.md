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

// wrangler.jsonc の durable_objects.class_name で HakoniwaGame を、exports で CachedPages を
// 解決するため、このファイルから再エクスポートする必要がある
export { CachedPages, HakoniwaGame } from "@hakoniwajs/cloudflare";

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
  // Workers Cache。Gateway (default) は無効にし、CachedPages だけ有効にする (wrangler 4.107.0 以降)
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "CachedPages": { "type": "worker", "cache": { "enabled": true } },
  },
  "durable_objects": {
    "bindings": [{ "name": "GAME", "class_name": "HakoniwaGame" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HakoniwaGame"] }],
  "triggers": { "crons": ["*/15 * * * *"] },
  "vars": { "HAKONIWA_DEV_LOGIN": "false" },
}
```

必須の secret はありません。`HAKONIWA_AUTH_SECRET` は未設定なら初回起動時に自動生成して Durable Object に保存します。管理者は、デプロイ後にログインして `/admin/setup` を開き、Workers のログに出力されるセットアップコードを入力すると登録できます (`HAKONIWA_ADMIN_EMAILS` で指定しておくこともできます)。X / Discord ログインや Resend などの秘密情報を使う場合は `wrangler secret put <NAME>` で登録してください。設定項目の一覧は [環境変数一覧](https://hakoniwajs.github.io/hakoniwa/setup/environment-variables/) を参照してください。

## API

- `createWorker(options?)` — `fetch`/`scheduled` を持つ Worker オブジェクト (Gateway) を返します。`options.doBinding` で DO バインディング名を `GAME` 以外に変更できます。
- `HakoniwaGame` — Durable Object クラス (上記の通り再エクスポート必須)。
- `CachedPages` — [Workers Cache](https://developers.cloudflare.com/workers/cache/) を有効にする内側のエントリポイント (上記の通り再エクスポート必須)。Gateway が `ctx.exports` 経由で呼び、キャッシュしてよい応答だけをここで DO から取得します。再エクスポートしていない場合は、キャッシュを使わずに DO へ直接転送します。
- `createCachedPages(options?)` — `doBinding` などを変えた場合に使います。`createWorker` と同じオプションを渡し、`export const CachedPages = createCachedPages({ doBinding: "..." })` のように export してください。

## License

オリジナルの利用条件に従います ([LICENSE](https://github.com/hakoniwajs/hakoniwa/blob/main/LICENSE))。同梱画像の商用利用はできません。
