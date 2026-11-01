// `@hono/vite-dev-server` は src/dev.ts を最初のリクエストまで読み込まない。
// dev.ts の検査だけだと `vp dev` / `pnpm dev` は起動したままになり、ページを開いて初めて落ちる。
// listen する前の configureServer で、server.ts と同じくメッセージだけを出して終了コード 1 で止める。
// Cloudflare 版はこのプラグインを使わない (リクエストのオリジンから base URL を決める)。
import {
  HAKONIWA_BASE_URL_REQUIRED_MESSAGE,
  isHakoniwaBaseUrlUnset,
} from "./src/base-url-required.ts";

type GuardEnv = { command: string; mode: string };

type GuardServer = { config?: { mode?: string } };

/** 開発サーバー起動時に Node の設定不足を検査する Vite プラグイン。build とテストでは動かない。 */
export function hakoniwaDevServerGuardPlugin() {
  return {
    name: "hakoniwa-dev-server-guard",
    apply(_config: unknown, env: GuardEnv): boolean {
      // Vitest も command === "serve" で設定を読む。テストランナーでは検査して止めない。
      if (process.env.VITEST === "true") return false;
      return env.command === "serve" && env.mode !== "test";
    },
    configureServer(server: GuardServer = {}): void {
      if (process.env.VITEST === "true" || server.config?.mode === "test") return;
      if (!isHakoniwaBaseUrlUnset(process.env)) return;
      console.error(HAKONIWA_BASE_URL_REQUIRED_MESSAGE);
      process.exit(1);
    },
  };
}
