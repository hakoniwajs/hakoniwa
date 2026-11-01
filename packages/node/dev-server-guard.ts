// `@hono/vite-dev-server` は src/dev.ts を最初のリクエストまで読み込まない。
// dev.ts の検査だけだと `vp dev` / `pnpm dev` は起動したままになり、ページを開いて初めて落ちる。
// listen する前の configureServer で、非ループバックかつ HAKONIWA_BASE_URL 未設定なら
// server.ts と同じくメッセージだけを出して終了コード 1 で止める。
// ループバック (Vite の既定は localhost) なら listen 後の実際のポートで
// `http://localhost:<port>` を process.env に入れる。dev.ts はリクエスト時にそれを読む。
// リクエストの Host ヘッダは使わない。Cloudflare 版はこのプラグインを使わない。
import {
  decideNodeBaseUrl,
  effectiveViteListenHost,
  isHakoniwaBaseUrlUnset,
  loopbackBaseUrl,
} from "./src/base-url-required.ts";

type GuardEnv = { command: string; mode: string };

type BoundAddress = { port?: number } | string | null;

type GuardHttpServer = {
  listening?: boolean;
  address?: () => BoundAddress;
  once?: (event: string, listener: () => void) => void;
};

type GuardServer = {
  config?: { mode?: string; server?: { host?: string | boolean; port?: number } };
  httpServer?: GuardHttpServer | null;
};

function boundPort(httpServer: GuardHttpServer | null | undefined): number | undefined {
  const address = httpServer?.address?.();
  if (typeof address === "object" && address !== null && typeof address.port === "number") {
    return address.port;
  }
  return undefined;
}

/** 開発サーバー起動時に Node の公開 URL を決める Vite プラグイン。build とテストでは動かない。 */
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
      const listenHost = effectiveViteListenHost(server.config?.server?.host);
      const decision = decideNodeBaseUrl({ configuredBaseUrl: undefined, listenHost });
      if (!decision.ok) {
        console.error(decision.message);
        process.exit(1);
      }
      const apply = (): void => {
        if (!isHakoniwaBaseUrlUnset(process.env)) return;
        const port = boundPort(server.httpServer);
        if (port === undefined) return;
        process.env.HAKONIWA_BASE_URL = loopbackBaseUrl(port);
      };
      const httpServer = server.httpServer;
      if (httpServer?.listening === true) {
        apply();
        return;
      }
      httpServer?.once?.("listening", apply);
    },
  };
}
