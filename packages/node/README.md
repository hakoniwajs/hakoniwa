# @hakoniwajs/node

[箱庭諸島２ (TypeScript 版)](https://github.com/hakoniwajs/hakoniwa) の Node.js Adapter です。`node:sqlite` によるストレージ、HTTP サーバー、ファイルバックアップ、CLI を提供します。

## 使い方

Node.js 22.13 以上が必要です。

```console
$ npm install @hakoniwajs/node
$ npx hakoniwa serve
```

`http://localhost:3000/` でゲームが起動します (DB は既定で `./hakoniwa.db` に作成されます)。

### CLI

```console
$ npx hakoniwa --help
$ npx hakoniwa db init          # ゲームを初期化して開始
$ npx hakoniwa db status        # 現在の状態を表示
$ npx hakoniwa turn check       # 期限が来ていればターンを進める
$ npx hakoniwa backup list|create|restore|delete
```

### 主な環境変数

| 変数                    | 内容                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `HAKONIWA_AUTH_SECRET`  | **必須**。セッション署名・CSRF の鍵 (`openssl rand -base64 32` 等で生成) |
| `HAKONIWA_DB_PATH`      | SQLite DB のパス (既定 `./hakoniwa.db`)                                  |
| `HAKONIWA_PUBLIC_DIR`   | 静的アセットのパス (既定は同梱の `@hakoniwajs/core/public`)              |
| `HAKONIWA_ADMIN_EMAILS` | 管理者ユーザーのメールアドレス (カンマ区切り)                            |
| `HAKONIWA_DEV_LOGIN`    | `true` で開発ログインを有効化 (本番では `false`)                         |

全項目は [環境変数一覧](https://hakoniwajs.github.io/hakoniwa/setup/environment-variables/) を参照してください。

## License

オリジナルの利用条件に従います ([LICENSE](https://github.com/hakoniwajs/hakoniwa/blob/main/LICENSE))。同梱画像の商用利用はできません。
