// Node 版が HAKONIWA_BASE_URL 未設定で止めるときの文言。
// Vite の設定読み込み (dev-server-guard) からも使う。こちらは @hakoniwajs/core を
// import しない (設定ファイルを Node が直接読むと、core の JSON import で落ちる)。

export const HAKONIWA_BASE_URL_REQUIRED_MESSAGE =
  "loadNodeConfig: HAKONIWA_BASE_URL が未設定です。非ループバックアドレスで待ち受けるときは公開 URL が必要です。0.0.0.0、::、LAN や公開アドレス、Vite の --host、未指定の Node 待ち受け (全インターフェース) では、ブラウザで開く URL を設定してください。";

/** `loadConfigFromEnv` の nonEmpty と同じく、未設定と空文字だけを未設定とみなす。 */
export function isHakoniwaBaseUrlUnset(env: Record<string, string | undefined>): boolean {
  const raw = env.HAKONIWA_BASE_URL;
  return raw === undefined || raw === "";
}

/**
 * ループバックでだけ使う公開 URL。リクエストの Host ヘッダは見ない。
 * ポートは listen 後の実際の値 (Vite が空いているポートへずらした値を含む)。
 */
export function loopbackBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * `HAKONIWA_HOST` を待ち受けアドレスにする。未設定と空文字は Node の既定
 * (ホスト名を渡さない。IPv6 なら `::`、なければ `0.0.0.0`) で、ループバックではない。
 */
export function effectiveNodeListenHost(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  const trimmed = host.trim();
  if (trimmed === "") return undefined;
  return trimmed;
}

/**
 * Vite の `server.host`。未指定は localhost。`true` と `--host` は全インターフェース。
 */
export function effectiveViteListenHost(host: string | boolean | undefined): string {
  if (host === true) return "0.0.0.0";
  if (typeof host !== "string" || host.trim() === "") return "localhost";
  return host.trim();
}

/** localhost、127.0.0.0/8、::1。未指定 (Node の全インターフェース) は false。 */
export function isLoopbackListenHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  let value = host.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  const zone = value.indexOf("%");
  if (zone !== -1) {
    value = value.slice(0, zone);
  }
  if (value === "localhost" || value === "localhost.") return true;
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("::ffff:")) {
    return isLoopbackListenHost(value.slice("::ffff:".length));
  }
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return octets[0] === 127;
}

export type NodeBaseUrlDecision =
  | { ok: true; mode: "configured"; baseUrl: string }
  | { ok: true; mode: "loopback" }
  | { ok: false; message: string };

/**
 * 設定済みならその URL。未設定かつループバックなら後で `loopbackBaseUrl(実際のポート)`。
 * 未設定かつ非ループバックなら listen 前に出す一行エラー。
 */
export function decideNodeBaseUrl(input: {
  configuredBaseUrl: string | undefined;
  listenHost: string | undefined;
}): NodeBaseUrlDecision {
  if (input.configuredBaseUrl !== undefined && input.configuredBaseUrl !== "") {
    return { ok: true, mode: "configured", baseUrl: input.configuredBaseUrl };
  }
  if (isLoopbackListenHost(input.listenHost)) {
    return { ok: true, mode: "loopback" };
  }
  return { ok: false, message: HAKONIWA_BASE_URL_REQUIRED_MESSAGE };
}
