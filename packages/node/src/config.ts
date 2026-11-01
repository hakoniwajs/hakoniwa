// tmp/08-turn-trigger-admin-cli.md 「設定の読み込み (Node)」節。
// @hakoniwajs/core の loadConfigFromEnv に Node 固有の設定 (DB パス、ポート等) を足す。
import { loadConfigFromEnv } from "@hakoniwajs/core";
import type { AppConfig } from "@hakoniwajs/core";
import {
  decideNodeBaseUrl,
  effectiveNodeListenHost,
  loopbackBaseUrl,
} from "./base-url-required.ts";

export interface NodeConfig extends AppConfig {
  port: number;
  /**
   * `server.listen` に渡すアドレス。`undefined` は Node の既定 (全インターフェース) で、
   * ループバックではない。
   */
  listenHost: string | undefined;
  dbPath: string;
  backupDir: string;
  turnCheckIntervalSec: number;
}

export interface LoadNodeConfigOptions {
  /**
   * false なら HTTP で待ち受けないコマンド。リクエストを受け取らないので、
   * `HAKONIWA_BASE_URL` が無ければ `http://localhost:<port>` を入れる。
   * 省略または true ならサーバー。非ループバックで未設定なら listen 前に例外にする。
   * ループバックで未設定なら `auth.baseUrl` は空けたまま返し、`startServer` が
   * 実際に束縛したポートで埋める。
   */
  listen?: boolean;
}

function parseInteger(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`loadNodeConfig: ${name} must be an integer (got: ${JSON.stringify(raw)})`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `loadNodeConfig: ${name} is out of safe integer range (got: ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

/** `process.env` (既定) から Node Adapter 用の設定一式を組み立てる。 */
export function loadNodeConfig(
  env: Record<string, string | undefined> = process.env,
  options?: LoadNodeConfigOptions,
): NodeConfig {
  const appConfig = loadConfigFromEnv(env);
  const port = parseInteger("PORT", env.PORT, 3000);
  const listenHost = effectiveNodeListenHost(env.HAKONIWA_HOST);
  // Node は Host ヘッダからリクエスト URL が決まる。未設定のまま公開すると、マジックリンクの
  // リンク先を Host で差し替えられる。ループバック待ち受けだけ、http://localhost:<実際のポート>
  // に固定する (Host は見ない)。Cloudflare 版はここを通らない。
  const decision = decideNodeBaseUrl({
    configuredBaseUrl: appConfig.auth.baseUrl,
    listenHost,
  });
  let auth = appConfig.auth;
  if (options?.listen === false) {
    if (auth.baseUrl === undefined) {
      auth = { ...auth, baseUrl: loopbackBaseUrl(port) };
    }
  } else if (!decision.ok) {
    throw new Error(decision.message);
  }
  const dbPath = env.HAKONIWA_DB_PATH ?? "./data/hakoniwa.sqlite";
  const backupDir = env.HAKONIWA_BACKUP_DIR ?? "./data/backups";
  const turnCheckIntervalSec = parseInteger(
    "HAKONIWA_TURN_CHECK_INTERVAL_SEC",
    env.HAKONIWA_TURN_CHECK_INTERVAL_SEC,
    60,
  );
  return { ...appConfig, auth, port, listenHost, dbPath, backupDir, turnCheckIntervalSec };
}
