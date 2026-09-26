// wrangler.jsonc の bindings/vars/secrets に対応する `Env` 型。
// `HakoniwaGame` (game-object.ts) の import type { Env } from "./env.ts";
import type { HakoniwaGame } from "./game-object.ts";

export interface Env {
  /** durable_objects.bindings (wrangler.jsonc)。世界は 1 つなので getByName('main') で固定して使う。 */
  GAME: DurableObjectNamespace<HakoniwaGame>;

  /**
   * tmp/21-kv-snapshot-cache.md: 未ログイン GET のトップ/観光ページの View Model を保存する
   * Workers KV 名前空間 (`kv_namespaces` の binding 名 `SNAPSHOT`)。**省略可能**。
   * 未バインドなら worker.ts は常に DO へ転送する (Node 版・既存デプロイ・テストへの影響が無い)。
   */
  SNAPSHOT?: KVNamespace;

  // 以下は vars (wrangler.jsonc) または `wrangler secret put` で設定する。
  // すべて loadConfigFromEnv (@hakoniwajs/core) がそのまま読む文字列環境変数。
  HAKONIWA_BASE_URL?: string;
  /** 任意。未設定なら初回起動時に自動生成して DO の settings 表に保存する。 */
  HAKONIWA_AUTH_SECRET?: string;
  HAKONIWA_X_CLIENT_ID?: string;
  HAKONIWA_X_CLIENT_SECRET?: string;
  HAKONIWA_DISCORD_CLIENT_ID?: string;
  HAKONIWA_DISCORD_CLIENT_SECRET?: string;
  HAKONIWA_RESEND_API_KEY?: string;
  HAKONIWA_MAIL_FROM?: string;
  HAKONIWA_DEV_LOGIN?: string;
  /** 任意。未設定でも `/admin/setup` とセットアップコード (ログに出力) で最初の管理者を登録できる。 */
  HAKONIWA_ADMIN_EMAILS?: string;
  HAKONIWA_ADMIN_ENABLED?: string;
  HAKONIWA_DEBUG?: string;
  /** 未設定なら Workers 版の既定値 3 (game-object.ts の WORKERS_DEFAULT_MAX_CATCH_UP_TURNS)。 */
  HAKONIWA_MAX_CATCH_UP_TURNS?: string;
  // サイト設定 (HAKONIWA_SITE_TITLE / HAKONIWA_ADMIN_NAME / HAKONIWA_EMAIL / HAKONIWA_BBS_URL /
  // HAKONIWA_TOPPAGE_URL / HAKONIWA_NG_WORDS / HAKONIWA_USE_LBBS / HAKONIWA_TIMEZONE) は
  // 管理画面の「サイト設定」に移した。既存デプロイで設定済みなら、settings 表に値が無い間の
  // 既定値として loadConfigFromEnv がそのまま読む (非推奨。pickStringEnv が文字列の env を
  // すべて渡すため、ここに型を書かなくても読まれる)。
  // HAKONIWA_UNIT_TIME_SEC / HAKONIWA_START_AT / HAKONIWA_FINAL_TURN は廃止した (読まない)。

  // tmp/21-kv-snapshot-cache.md: KV スナップショットの TTL (秒)。SNAPSHOT が未バインドなら
  // 無視される。`snapshot.ts` の `loadSnapshotTtlConfig` が読む (Workers KV の最小 TTL 60 秒
  // 未満を指定した場合は 60 に切り上げる)。
  /** 進行中/開始前のゲーム、または現在のゲームの終了済み島ページの TTL。既定 60。 */
  HAKONIWA_SNAPSHOT_TTL_SEC?: string;
  /** 過去のゲーム、または現在のゲームの終了済みトップページの TTL (不変なので長期)。既定 2592000 (30日)。 */
  HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC?: string;
}
