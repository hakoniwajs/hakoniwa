// tmp/08-turn-trigger-admin-cli.md 「設定の読み込み (Node)」節。
// @hakoniwajs/core の loadConfigFromEnv に Node 固有の設定 (DB パス、ポート等) を足す。
import { loadConfigFromEnv } from "@hakoniwajs/core";
import type { AppConfig } from "@hakoniwajs/core";

export interface NodeConfig extends AppConfig {
  port: number;
  dbPath: string;
  backupDir: string;
  turnCheckIntervalSec: number;
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
export function loadNodeConfig(env: Record<string, string | undefined> = process.env): NodeConfig {
  const appConfig = loadConfigFromEnv(env);
  // Node は Host ヘッダからリクエスト URL が決まる。未設定のまま起動すると、マジックリンクの
  // リンク先を Host で差し替えられる。Cloudflare 版はここを通らない。
  if (appConfig.auth.baseUrl === undefined) {
    throw new Error(
      "loadNodeConfig: HAKONIWA_BASE_URL が未設定です。Node.js 版では公開 URL が必要です。開発サーバーなら HAKONIWA_BASE_URL=http://localhost:5173、hakoniwa serve の既定ポートなら HAKONIWA_BASE_URL=http://localhost:3000 を設定してください。公開するときは、ブラウザで開く URL を設定してください。",
    );
  }
  const port = parseInteger("PORT", env.PORT, 3000);
  const dbPath = env.HAKONIWA_DB_PATH ?? "./data/hakoniwa.sqlite";
  const backupDir = env.HAKONIWA_BACKUP_DIR ?? "./data/backups";
  const turnCheckIntervalSec = parseInteger(
    "HAKONIWA_TURN_CHECK_INTERVAL_SEC",
    env.HAKONIWA_TURN_CHECK_INTERVAL_SEC,
    60,
  );
  return { ...appConfig, port, dbPath, backupDir, turnCheckIntervalSec };
}
