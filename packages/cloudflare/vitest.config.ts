import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// tmp/09-tooling.md / tmp/12-workers-adapter.md: テストは @cloudflare/vitest-pool-workers
// (cloudflareTest プラグイン) で workerd 上で実行する。@cloudflare/vite-plugin (dev/build 用の
// vite.config.ts) とは同居できないため、テスト専用にこのファイルを分離する。
// root の vite.config.ts (`test.projects: ["packages/*"]`) は、ディレクトリ配下に
// vitest.config.ts があればそちらを優先して読むため、root 側の変更は不要。
export default defineConfig({
  test: {
    // workerd 上での初回リクエスト (better-auth/JSX の初期化を含む) はコールドスタートが
    // 既定の 5000ms を超えることがあるため、少し余裕を持たせる。
    testTimeout: 20000,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "../../wrangler.jsonc" },
      // wrangler.jsonc の vars を上書きし、開発ログインと管理者をテスト用に設定する。
      // HAKONIWA_AUTH_SECRET はあえて設定せず、DO の settings 表への自動生成の経路を通す。
      // 設計書との差異: wrangler.jsonc を root に移したことで、wrangler の
      // 「設定ファイルと同じディレクトリの .env を自動読み込みする」機能により、開発者の
      // root .env (Node 版の開発用。HAKONIWA_BASE_URL を設定していることがある) がこのテスト
      // 環境にも読み込まれてしまう。HAKONIWA_BASE_URL は省略可能な動作を検証したいため、
      // 空文字列で明示的に上書きし (loadConfigFromEnv の nonEmpty() が undefined 扱いする)、
      // .env の有無に依存しないようにする。
      miniflare: {
        bindings: {
          HAKONIWA_DEV_LOGIN: "true",
          HAKONIWA_ADMIN_EMAILS: "admin@example.com",
          HAKONIWA_BASE_URL: "",
        },
      },
    }),
  ],
});
