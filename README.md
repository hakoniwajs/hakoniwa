# 箱庭諸島２

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hakoniwajs/template-cloudflare)

📖 **ドキュメント: https://hakoniwajs.github.io/hakoniwa/**

徳岡宏樹氏による Web ブラウザゲーム「箱庭諸島２」を、TypeScript (Node.js + Hono + `node:sqlite`) で書き直したものです。
ゲームロジックと HTTP 層をランタイムから独立させてあり、Node.js と Cloudflare Workers (Durable Objects SQLite) の両方で動かせる構成にしています。

プレイヤーは自分の島を発見し、開発計画 (整地、農場整備、ミサイル発射など) を登録します。
一定時間 (既定 6 時間) ごとにターンが進み、すべての島で計画の実行、人口の増減、災害、怪獣の出現などが処理されます。

このリポジトリは [neguse/hakoniwa](https://github.com/neguse/hakoniwa) の fork です。fork 元は、オリジナルの Perl スクリプトを UTF-8 化し、モジュール分割と Plack 対応を施して現代の Perl で動くようにしたものでした。本リポジトリではその Perl 版をもとに TypeScript へ移植し、Perl 版のコードは削除しています (履歴は git log で辿れます)。

## 機能

- **ゲーム本体**: オリジナル (箱庭諸島 ver2.3) のルールを移植しています。ゲームごとに 1 ユーザー 1 島です。
- **ログイン**: X (Twitter) / Discord / メール (マジックリンク) / 開発ログイン (ローカル開発・検証用) に対応しています ([better-auth](https://www.better-auth.com/) を使用)。管理画面から方法ごとに ON/OFF を切り替えられ、アカウント設定画面から複数の方法を同じアカウントに連携できます。
- **管理者**: メールアドレスを指定した特定のユーザーだけが管理画面 (`/admin`) を使えます。
- **NG ワード**: 島名・コメント・掲示板の投稿に含まれる不適切な語を拒否します。
- **シーズン**: 開始時刻、最終ターン (結果発表)、1 ターンの長さを設定できます。最終ターンに達するか管理者が手動で終了させるとゲームが終了し、以降は計画登録などができなくなります。
- **複数ゲーム**: 同時に実行できるゲームは 1 つですが、終了後は次のゲームを開始でき、過去のゲームは読み取り専用のまま残ります (`/games` から一覧・閲覧できます)。
- **OGP 画像**: 島ページをシェアすると、島の地図を描画した PNG が OGP 画像として表示されます。
- **スマートフォン対応**: スマートフォンの画面幅でも入力欄や長い URL がはみ出さないようにしています。
- **2 つの実行環境**: Node.js (`node:sqlite`) と Cloudflare Workers (Durable Objects SQLite) のどちらでも同じゲームロジックで動きます。

## npm パッケージ

`npm install` するだけで自分の環境に箱庭諸島２を設置できます。

| パッケージ               | 内容                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `@hakoniwajs/node`       | Node.js 版。`npx hakoniwa serve` で HTTP サーバーが起動します        |
| `@hakoniwajs/cloudflare` | Cloudflare Workers (Durable Objects) 版。Worker エントリを提供します |
| `@hakoniwajs/core`       | ランタイム非依存のゲーム本体 (上の 2 つが依存しています)             |

設置手順は [設置ガイド](https://hakoniwajs.github.io/hakoniwa/setup/) を参照してください。Cloudflare Workers へは上の Deploy ボタン (テンプレート: [hakoniwajs/template-cloudflare](https://github.com/hakoniwajs/template-cloudflare)) からもデプロイできます。

## ドキュメント

ドキュメントは [https://hakoniwajs.github.io/hakoniwa/](https://hakoniwajs.github.io/hakoniwa/) で公開しています (ソースは [`website/`](website/)。[Blume](https://useblume.dev/) でビルドしています)。

- 自分の環境にデプロイ・設置する方は [設置ガイド](https://hakoniwajs.github.io/hakoniwa/setup/) を参照してください。
- 管理画面や CLI の使い方は [運営する](https://hakoniwajs.github.io/hakoniwa/operation/admin/) を参照してください。
- 開発に参加する方は [開発者向けドキュメント](https://hakoniwajs.github.io/hakoniwa/development/) を参照してください。

## ライセンス

このリポジトリはオリジナルの「箱庭諸島２」の利用条件に従います。素晴らしいゲームを作られた原作者の方々、および Perl 版を現代の環境で動くよう整備してくださった fork 元 ([neguse/hakoniwa](https://github.com/neguse/hakoniwa)) の作者に感謝します。

- 字: 徳岡宏樹
- 絵: 小川克人
- 題字: 稲葉修吾
- テストプレイ他協力: 井上友博、小澤武史、さかもと、ほえほえ、ありづか

### スクリプトについて

オリジナルの readme (`hako-readme.txt` に同梱) では、改変版を配布する際の条件として次を定めています。

- 無料で配布すること
- ゲーム画面の最上部にある、スクリプト配布元 (http://www.bekkoame.ne.jp/~tokuoka/hakoniwa.html) へのリンクを消さないこと。それ以外の改造は自由
- 改変版も同じ条件で再配布を許可すること
- 配布ページに、オリジナルの配布元へのリンクを置くこと

この移植版でも画面最上部の配布元リンクは維持しています。なお原作者のサイトは現在アクセスできないため、最後の条件は実質的に満たせない状態です。

### 画像について

同梱の画像 (`packages/core/public/images`) は小川克人氏の著作物です。原作者サイトのアーカイブにある FAQ によれば、その後の許諾により「商用でない限り、箱庭諸島以外の用途でも配布・改変可」とされています。商用利用はできません。何か問題が起きても画像の原作者は関知しない、とのことです。

### X / Discord のブランドアセットについて

X / Discord のログイン・連携ボタンのロゴは、各社の公式ブランドアセット
([X Brand Toolkit](https://about.x.com/en/who-we-are/brand-toolkit)、
[Discord Branding](https://discord.com/branding)) をそのまま使用しており、各社の商標ガイドラインに
従います。X ロゴは Brand Toolkit の SVG を黒配色で使用しています。

## 参考にしたサイト

- 再配布: [箱庭諸島の保管庫](http://www.hakoniwa.net/hako/)、[箱庭なページ](http://hako.gob.jp/)、[Neo-INO](http://neo-sub.sakura.ne.jp/ino/hako/download.html)
- 解説: [箱庭解体新書](http://qqmh3psd.web.fc2.com/sadoga/)
- 原作者サイトのアーカイブ: [Wayback Machine](https://web.archive.org/web/20070113153728/http://t.pos.to/hako/)
