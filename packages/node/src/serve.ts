// tmp/02-architecture.md 「Adapter を薄くする方針」、tmp/08-turn-trigger-admin-cli.md
// 「トリガー2: 外部 (Adapter 側)」節の実装。`vp build` 後 `node dist/server.js` で起動する。
// npm パッケージとしては `hakoniwa serve` (cli.ts) からも起動できる。
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { decideNodeBaseUrl, loopbackBaseUrl } from "./base-url-required.ts";
import { composeNode } from "./compose.ts";
import type { ComposedNode } from "./compose.ts";
import type { NodeConfig } from "./config.ts";

/**
 * `@hakoniwajs/core` の `public/` (images/style.css/owner.js) の配信元ディレクトリを決める。
 * 1. `HAKONIWA_PUBLIC_DIR` があればそれを使う。
 * 2. npm パッケージとしてインストールされた場合は `@hakoniwajs/core/package.json` を
 *    `require.resolve` で解決し、その隣の `public/` を使う (pnpm のシム構造でも実体を指す)。
 * 3. モノレポ構成のまま動かす場合向けに `../../core/public` を試す。
 *    `src/serve.ts` (dev) と `dist/server.js` (build) はどちらも `packages/node/` の
 *    1 階層下にあるため、同じ相対パスが dev/build のどちらからでも `packages/core/public` を指す。
 * 4. `dist/` だけを配置するデプロイ向けに、`vite.config.ts` の `publicDir` でビルド時に
 *    `dist/server.js` と同じディレクトリへ直接コピーされる (Vite の既定動作: `publicDir` の中身は
 *    `outDir` サブディレクトリではなくルート直下に展開される) ため、スクリプトと同じディレクトリに
 *    フォールバックする (`vp build` の結果は `dist/public` ではなく `dist/images/*`
 *    `dist/style.css` `dist/owner.js` のように dist 直下に置かれる)。
 */
function resolvePublicDir(): string {
  const fromEnv = process.env.HAKONIWA_PUBLIC_DIR;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  // npm インストール済みパッケージの配置を解決する。依存パッケージ側の exports に
  // "./package.json" を公開させてあるため、これは package.json の exports 制約に違反しない。
  const require = createRequire(import.meta.url);
  try {
    const corePackageJson = require.resolve("@hakoniwajs/core/package.json");
    const corePublicDir = join(dirname(corePackageJson), "public");
    if (existsSync(join(corePublicDir, "images"))) {
      return corePublicDir;
    }
  } catch {
    // @hakoniwajs/core が解決できない (バンドルされた dist 等) 場合は次へ
  }
  const monorepoPublicDir = fileURLToPath(new URL("../../core/public", import.meta.url));
  if (existsSync(join(monorepoPublicDir, "images"))) {
    return monorepoPublicDir;
  }
  return fileURLToPath(new URL(".", import.meta.url));
}

function withBaseUrl(config: NodeConfig, baseUrl: string): NodeConfig {
  return { ...config, auth: { ...config.auth, baseUrl } };
}

function warnDevLogin(config: NodeConfig): void {
  // tmp/14-users-auth.md 「開発ログインの保護」節: 本番で誤って有効化されないよう起動時に警告する。
  if (config.auth.devLogin) {
    console.warn(
      "hakoniwa: HAKONIWA_DEV_LOGIN=true です。開発ログイン (任意のメールアドレスでログインできる機能) が有効になっています。本番環境では無効にしてください。",
    );
  }
}

/** Adapter 側で静的ルートを登録してから、ランタイム非依存の Hono app をマウントする。 */
function mountApp(config: NodeConfig): { root: Hono; deps: ComposedNode; publicDir: string } {
  const deps = composeNode(config);
  const publicDir = resolvePublicDir();
  const root = new Hono();
  root.use("/images/*", serveStatic({ root: publicDir }));
  root.use("/style.css", serveStatic({ root: publicDir }));
  root.use("/owner.js", serveStatic({ root: publicDir }));
  root.route("/", deps.app);
  return { root, deps, publicDir };
}

function startTurnTimer(
  config: NodeConfig,
  deps: ComposedNode,
): ReturnType<typeof setInterval> | undefined {
  // ターン進行の外部トリガー。0 なら無効化する。
  if (config.turnCheckIntervalSec <= 0) return undefined;
  const timer = setInterval(() => {
    try {
      deps.turnService.advanceTurnIfDue(Math.floor(Date.now() / 1000));
    } catch (err) {
      console.error("hakoniwa: turn check failed", err);
    }
  }, config.turnCheckIntervalSec * 1000);
  timer.unref();
  return timer;
}

function installShutdown(
  server: ServerType,
  getDeps: () => ComposedNode | undefined,
  getTimer: () => ReturnType<typeof setInterval> | undefined,
): void {
  function shutdown(signal: string): void {
    console.log(`hakoniwa: received ${signal}, shutting down...`);
    const timer = getTimer();
    if (timer !== undefined) {
      clearInterval(timer);
    }
    server.close((err) => {
      if (err !== undefined) {
        console.error("hakoniwa: failed to close server", err);
      }
      try {
        getDeps()?.driver.close();
      } catch (closeErr) {
        console.error("hakoniwa: failed to close driver", closeErr);
      }
      process.exit(err !== undefined ? 1 : 0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function listenOptions(
  config: NodeConfig,
  fetch: (request: Request, env: object) => Response | Promise<Response>,
) {
  return {
    fetch,
    port: config.port,
    ...(config.listenHost !== undefined ? { hostname: config.listenHost } : {}),
  };
}

export function startServer(config: NodeConfig): ServerType {
  warnDevLogin(config);
  // 非ループバックで URL が無ければ、ソケットを開く前に止める。
  const decision = decideNodeBaseUrl({
    configuredBaseUrl: config.auth.baseUrl,
    listenHost: config.listenHost,
  });
  if (!decision.ok) {
    throw new Error(decision.message);
  }

  if (decision.mode === "configured") {
    const mounted = mountApp(config);
    const timer = startTurnTimer(config, mounted.deps);
    const server = serve(
      listenOptions(config, (request, env) => mounted.root.fetch(request, env)),
      (info) => {
        console.log(
          `hakoniwa: listening on http://localhost:${info.port}/ (public: ${mounted.publicDir})`,
        );
      },
    );
    installShutdown(
      server,
      () => mounted.deps,
      () => timer,
    );
    return server;
  }

  // ループバックの既定 URL は、listen が選んだポート (PORT=0 や、指定ポートそのもの) を使う。
  // アプリはポートが分かるまで組み立てない。それより前のリクエストは 503。
  let mounted: { root: Hono; deps: ComposedNode; publicDir: string } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let server: ServerType | undefined;
  server = serve(
    listenOptions(config, (request, env) => {
      if (mounted === undefined) {
        return new Response(null, { status: 503 });
      }
      return mounted.root.fetch(request, env);
    }),
    (info) => {
      try {
        const resolved = withBaseUrl({ ...config, port: info.port }, loopbackBaseUrl(info.port));
        mounted = mountApp(resolved);
        timer = startTurnTimer(resolved, mounted.deps);
        console.log(
          `hakoniwa: listening on http://localhost:${info.port}/ (public: ${mounted.publicDir})`,
        );
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        server?.close(() => {
          process.exit(1);
        });
      }
    },
  );
  installShutdown(
    server,
    () => mounted?.deps,
    () => timer,
  );
  return server;
}
