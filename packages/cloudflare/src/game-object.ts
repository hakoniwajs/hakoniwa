// tmp/12-workers-adapter.md 「Worker エントリ (worker.ts, game-object.ts) の骨子」節の実装。
// 1 インスタンス = ゲーム世界 1 つ。DO の SQLite ストレージに Node 版と同じスキーマを構築し、
// @hakoniwajs/core の buildDeps で組み立てた Hono app にそのまま委譲する。
import { DurableObject } from "cloudflare:workers";
import { AppError, buildDeps, buildSeasonVM, loadConfigFromEnv, migrate } from "@hakoniwajs/core";
import type { AppConfig, BuiltDeps } from "@hakoniwajs/core";
import { BookmarkBackupStore } from "./backup.ts";
import { DurableObjectSqlDriver } from "./driver.ts";
import type { Env } from "./env.ts";
import { computeSnapshotTtl, loadSnapshotTtlConfig, toIslandPageSnapshotVM } from "./snapshot.ts";
import type { PageSnapshotRequest, PageSnapshotResult } from "./snapshot.ts";

/**
 * ゲーム世界を 1 つ保持する Durable Object。
 *
 * - `fetch`: 組み立てた Hono app (`@hakoniwajs/core` の `createApp`) にそのまま委譲する。
 * - `checkTurn`: Cron Trigger から呼ばれる RPC。`turnService.advanceTurnIfDue` を呼ぶだけで、
 *   ターン境界を跨いだかどうかの判定は turnService 側 (`unitTimeSec` と `game.last_time`) に任せる。
 */
export class HakoniwaGame extends DurableObject<Env> {
  #deps: BuiltDeps | undefined;

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
      this.#deps = buildDeps({ driver, backupStore, clock, config });
    });
  }

  override fetch(request: Request): Response | Promise<Response> {
    return this.#requireDeps().app.fetch(request);
  }

  /** Cron Trigger から呼ばれる。進めたターン数を返す。 */
  checkTurn(): number {
    const now = Math.floor(Date.now() / 1000);
    return this.#requireDeps().turnService.advanceTurnIfDue(now);
  }

  /**
   * tmp/21-kv-snapshot-cache.md: 未ログイン GET のトップ/観光ページ用の RPC。worker.ts が
   * KV キャッシュを外した (ミスした) ときに呼ぶ。対象のゲーム/島が無ければ `undefined` を返し、
   * 呼び出し側は従来どおり `fetch` (DO への HTTP 転送) にフォールバックする。
   * TTL はここ (DO 側) で決める (Worker 側に「不変かどうか」の判定を持たせないため)。
   */
  pageSnapshot(input: PageSnapshotRequest): PageSnapshotResult | undefined {
    const deps = this.#requireDeps();
    const { ttlSec, ttlImmutableSec } = loadSnapshotTtlConfig(this.env);
    const now = Math.floor(Date.now() / 1000);
    try {
      if (input.kind === "top") {
        const vm = deps.gameService.getTopPage(undefined, input.gameId);
        const nextTurnAt = vm.season.nextTurnAt;
        const ttl = computeSnapshotTtl({
          kind: "top",
          isCurrent: vm.game.isCurrent,
          seasonState: vm.season.state,
          nextTurnAt,
          now,
          ttlSec,
          ttlImmutableSec,
        });
        return { kind: "top", vm, nextTurnAt, ttl };
      }
      const vm = deps.gameService.getIslandPage(input.gameId, input.islandId);
      // IslandPageVM には season が無いため、TTL 判定用に別途取得する
      // (getIslandPage が成功した時点でゲームの存在は確認済み)。
      const season = buildSeasonVM(deps.repo.getMeta(input.gameId));
      const ttl = computeSnapshotTtl({
        kind: "island",
        isCurrent: vm.game.isCurrent,
        seasonState: season.state,
        nextTurnAt: season.nextTurnAt,
        now,
        ttlSec,
        ttlImmutableSec,
      });
      return {
        kind: "island",
        vm: toIslandPageSnapshotVM(vm),
        nextTurnAt: season.nextTurnAt,
        ttl,
      };
    } catch (err) {
      if (err instanceof AppError) {
        // ゲーム/島が無い、未初期化等。呼び出し側 (worker.ts) が DO への通常の fetch に
        // フォールバックし、いつもどおりのエラー画面 (app.onError) を出す。
        return undefined;
      }
      throw err;
    }
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
 * 眠っていた場合でも少ない呼び出しで追いつけるようにする (以前は wrangler.jsonc の vars に
 * "3" を書いていたが、Deploy to Cloudflare の入力項目を減らすためコード側の既定値にした)。
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
 * `GAME` (DurableObjectNamespace)・`SNAPSHOT` (KVNamespace) 等のバインディングは文字列では
 * ないため除外される。worker.ts も同じ `AppConfig` を組み立てるために export する
 * (tmp/21-kv-snapshot-cache.md: Worker 側レンダリングに `GameConfig`/timezone が要る)。
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
