// tmp/12-workers-adapter.md 「Worker エントリ (worker.ts, game-object.ts) の骨子」節の実装。
// 1 インスタンス = ゲーム世界 1 つ。DO の SQLite ストレージに Node 版と同じスキーマを構築し、
// @hakoniwajs/core の buildDeps で組み立てた Hono app にそのまま委譲する。
import { DurableObject } from "cloudflare:workers";
import { buildDeps, loadConfigFromEnv, migrate } from "@hakoniwajs/core";
import type { AppConfig, BuiltDeps } from "@hakoniwajs/core";
import { BookmarkBackupStore } from "./backup.ts";
import { revSetCookie } from "./cache-policy.ts";
import { DurableObjectSqlDriver } from "./driver.ts";
import type { Env } from "./env.ts";

/**
 * ゲーム世界を 1 つ保持する Durable Object。
 *
 * - `fetch`: 組み立てた Hono app (`@hakoniwajs/core` の `createApp`) に委譲する。状態を変える
 *   リクエスト (GET/HEAD 以外) の応答には Cookie `hako_rev` (世代番号) を付ける。
 * - `authSecret`: Gateway (worker.ts) がセッションの Cookie キャッシュを検証するための auth secret。
 * - `checkTurn`: Cron Trigger から呼ばれる RPC。`turnService.advanceTurnIfDue` を呼ぶだけで、
 *   ターン境界を跨いだかどうかの判定は turnService 側 (`unitTimeSec` と `game.last_time`) に任せる。
 */
export class HakoniwaGame extends DurableObject<Env> {
  #deps: BuiltDeps | undefined;
  #lastRev = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // constructor 内では await しない (blockConcurrencyWhile が完了するまで fetch/checkTurn は
    // 呼ばれないので、このまま Promise を返さなくてよい)。
    void ctx.blockConcurrencyWhile(async () => {
      const driver = new DurableObjectSqlDriver(ctx.storage);
      const config = loadWorkerConfig(env);
      migrate(driver, { defaultUnitTimeSec: config.game.unitTimeSec });
      const backupStore = new BookmarkBackupStore(ctx);
      const clock = { now: () => Math.floor(Date.now() / 1000) };
      // Issue #25 (Workers Cache):
      // - cacheHints: エッジでキャッシュしてよいページに目安のヘッダを付け、CachedPages
      //   (cached-pages.ts) が Workers Cache 用の Cache-Control に変換する。
      // - sessionCookieCache: better-auth のセッションの Cookie キャッシュを有効にし、Gateway が
      //   DO に問い合わせずにセッションを検証できるようにする。
      this.#deps = buildDeps({
        driver,
        backupStore,
        clock,
        config,
        cacheHints: true,
        sessionCookieCache: true,
      });
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const response = await this.#requireDeps().app.fetch(request);
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || response.status < 200) {
      return response;
    }
    // 状態を変えるリクエストの応答に新しい世代番号を付ける。Gateway はこれをログイン中の
    // ページの props (`rev`) に入れるので、自分の操作の直後の GET はキャッシュされていない
    // 新しいキーになり、必ず最新の内容が表示される。
    const headers = new Headers(response.headers);
    headers.append(
      "set-cookie",
      revSetCookie(this.#nextRev(), new URL(request.url).protocol === "https:"),
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /**
   * auth secret (`HAKONIWA_AUTH_SECRET`、未設定なら settings 表の自動生成値)。Gateway が
   * セッションの Cookie キャッシュの署名を検証するために、isolate ごとに 1 回だけ呼ぶ
   * (DO のスタブは同じ Worker の中からしか呼べない)。
   */
  authSecret(): string {
    return this.#requireDeps().authSecret;
  }

  /** 単調増加する世代番号 (36 進数)。現在時刻 (ミリ秒) を基に、前回より必ず大きくする。 */
  #nextRev(): string {
    this.#lastRev = Math.max(Date.now(), this.#lastRev + 1);
    return this.#lastRev.toString(36);
  }

  /** Cron Trigger から呼ばれる。進めたターン数を返す。 */
  checkTurn(): number {
    const now = Math.floor(Date.now() / 1000);
    return this.#requireDeps().turnService.advanceTurnIfDue(now);
  }

  #requireDeps(): BuiltDeps {
    if (this.#deps === undefined) {
      // blockConcurrencyWhile が完了する前に fetch/checkTurn が呼ばれることは無いはずだが、
      // 型上 undefined を許すため防御的にエラーにする。
      throw new Error("HakoniwaGame: not initialized yet");
    }
    return this.#deps;
  }
}

/**
 * Workers 版の `HAKONIWA_MAX_CATCH_UP_TURNS` の既定値。Cron Trigger (15 分ごと) やリクエスト時の
 * 追いつき処理で 1 回に進めるターン数の上限。core の既定値 (1) より大きくし、DO が長く
 * 眠っていた場合でも少ない呼び出しで追いつけるようにする (Deploy to Cloudflare の入力項目を
 * 減らすため、wrangler.jsonc の vars ではなくコード側の既定値にしている)。
 */
export const WORKERS_DEFAULT_MAX_CATCH_UP_TURNS = 3;

/**
 * Workers の `env` から `AppConfig` を組み立てる。`loadConfigFromEnv` に Workers 固有の既定値
 * (`HAKONIWA_MAX_CATCH_UP_TURNS`) を足す。DO (game-object.ts) と Worker (worker.ts) の両方で使う。
 */
export function loadWorkerConfig(env: Env): AppConfig {
  const stringEnv = pickStringEnv(env);
  if (
    stringEnv.HAKONIWA_MAX_CATCH_UP_TURNS === undefined ||
    stringEnv.HAKONIWA_MAX_CATCH_UP_TURNS === ""
  ) {
    stringEnv.HAKONIWA_MAX_CATCH_UP_TURNS = String(WORKERS_DEFAULT_MAX_CATCH_UP_TURNS);
  }
  return loadConfigFromEnv(stringEnv);
}

/**
 * `env` (バインディングを含む) から、`loadConfigFromEnv` が読む文字列の環境変数だけを取り出す。
 * `GAME` (DurableObjectNamespace) 等のバインディングは文字列ではないため除外される。
 */
export function pickStringEnv(env: Env): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
