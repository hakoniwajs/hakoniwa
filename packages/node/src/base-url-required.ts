// Node 版が HAKONIWA_BASE_URL 未設定で止めるときの文言。
// Vite の設定読み込み (dev-server-guard) からも使う。こちらは @hakoniwajs/core を
// import しない (設定ファイルを Node が直接読むと、core の JSON import で落ちる)。

export const HAKONIWA_BASE_URL_REQUIRED_MESSAGE =
  "loadNodeConfig: HAKONIWA_BASE_URL が未設定です。Node.js 版では公開 URL が必要です。開発サーバーなら HAKONIWA_BASE_URL=http://localhost:5173、hakoniwa serve の既定ポートなら HAKONIWA_BASE_URL=http://localhost:3000 を設定してください。公開するときは、ブラウザで開く URL を設定してください。";

/** `loadConfigFromEnv` の nonEmpty と同じく、未設定と空文字だけを未設定とみなす。 */
export function isHakoniwaBaseUrlUnset(env: Record<string, string | undefined>): boolean {
  const raw = env.HAKONIWA_BASE_URL;
  return raw === undefined || raw === "";
}
