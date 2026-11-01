// `vp build` 後 `node dist/server.js` で起動するエントリポイント。
// 実体は serve.ts の startServer (npm パッケージの `hakoniwa serve` と共通)。
import { loadNodeConfig } from "./config.ts";
import { startServer } from "./serve.ts";

// 設定不足 (HAKONIWA_BASE_URL など) は hakoniwa serve と同様、listen する前に
// メッセージだけを stderr へ出して終了コード 1 で止める。
try {
  startServer(loadNodeConfig());
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
