// tmp/06-web-routes-and-views.md の web 層エントリポイント用の依存注入型。
// Phase 3a/3b で組み立てた Service 一式と、bootstrap/config-from-env.ts の AppConfig をまとめる。
import type { AdminPolicy } from "../app/admin-policy.ts";
import type { AdminService } from "../app/admin-service.ts";
import type { GameService } from "../app/game-service.ts";
import type { Clock, Logger } from "../app/ports.ts";
import type { SiteSettingsService } from "../app/site-settings.ts";
import type { TurnService } from "../app/turn-service.ts";
import type { AppConfig } from "../bootstrap/config-from-env.ts";
import type { createAuth } from "../bootstrap/auth.ts";

/** `createApp` に渡す依存一式。ランタイム非依存 (node:* や cloudflare:* を含まない)。 */
export interface WebDeps {
  gameService: GameService;
  turnService: TurnService;
  adminService: AdminService;
  /** 管理者判定 (環境変数 + settings 表) と初期セットアップ (`/admin/setup`)。 */
  adminPolicy: AdminPolicy;
  config: AppConfig;
  /**
   * 解決済みの auth secret (CSRF トークンの HMAC 鍵)。`config.auth.secret` は環境変数由来で
   * 省略可能なため、csrf ミドルウェアはこちらを使う。
   */
  authSecret: string;
  /**
   * サイト設定 (タイトル・フッタ・追加 NG ワード・ローカル掲示板・タイムゾーン)。管理画面から
   * 実行中に変わるため、ルートはリクエストごとに `get()` で読む (`config` に静的な値は無い)。
   */
  siteSettings: SiteSettingsService;
  /** turn-check ミドルウェアが使う時計。Date.now を直接使わない。 */
  clock: Clock;
  /** better-auth インスタンス。session-middleware/routes/auth.tsx/routes/account.tsx から使う。 */
  auth: ReturnType<typeof createAuth>;
  /** better-auth の APIError 等、想定内だがログに残したいエラーの記録先。 */
  logger: Logger;
}
