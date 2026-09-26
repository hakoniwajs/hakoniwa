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

| 変数                    | 内容                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `HAKONIWA_AUTH_SECRET`  | 任意。セッション署名・CSRF の鍵。未設定なら初回起動時に自動生成して DB に保存 |
| `HAKONIWA_DB_PATH`      | SQLite DB のパス (既定 `./hakoniwa.db`)                                       |
| `HAKONIWA_PUBLIC_DIR`   | 静的アセットのパス (既定は同梱の `@hakoniwajs/core/public`)                   |
| `HAKONIWA_ADMIN_EMAILS` | 任意。管理者ユーザーのメールアドレス (カンマ区切り)                           |
| `HAKONIWA_DEV_LOGIN`    | `true` で開発ログインを有効化 (本番では `false`)                              |

`HAKONIWA_ADMIN_EMAILS` を設定しない場合は、ログインしてから `/admin/setup` を開き、サーバーのコンソールに出力されるセットアップコードを入力すると最初の管理者になれます (以後は管理画面から管理者を追加・削除できます)。

全項目は [環境変数一覧](https://hakoniwajs.github.io/hakoniwa/setup/environment-variables/) を参照してください。

## License

オリジナルの利用条件に従います ([LICENSE](https://github.com/hakoniwajs/hakoniwa/blob/main/LICENSE))。同梱画像の商用利用はできません。
