// Worker の各エントリポイント (default の Gateway と CachedPages) から、ゲーム世界を保持する
// 単一の DO (`HakoniwaGame`) のスタブを取り出す共通処理。
import type { Env } from "./env.ts";
import type { HakoniwaGame } from "./game-object.ts";

/** DO の取得方法のオプション。`createWorker` / `createCachedPages` の両方で使う。 */
export interface GameStubOptions {
  /**
   * wrangler.jsonc の `durable_objects.bindings` の binding 名 (既定 `"GAME"`)。
   * `class_name` は `HakoniwaGame` 固定で、このパッケージから再エクスポートされる。
   */
  doBinding?: string;
  /**
   * DO の初回作成時の location hint (既定 `"apac-ne"` (北東アジア)。プレイヤーは日本在住が
   * 中心のため)。効くのは DO の **初回作成時のみ** でベストエフォート。既存の DO は移動しない。
   * 変更する場合は次のいずれかから選ぶ: wnam, enam, sam, weur, eeur, apac, apac-ne, apac-se, oc, afr, me
   * (参考: https://developers.cloudflare.com/durable-objects/reference/data-location/#provide-a-location-hint)
   */
  locationHint?: DurableObjectLocationHint;
}

export function resolveGameStubOptions(options: GameStubOptions): Required<GameStubOptions> {
  return {
    doBinding: options.doBinding ?? "GAME",
    locationHint: options.locationHint ?? "apac-ne",
  };
}

/** 世界は 1 つなので、常に `idFromName("main")` の DO を使う。 */
export function getGame(env: Env, options: Required<GameStubOptions>) {
  // binding 名は options.doBinding で変えられるため Env のプロパティを動的に引く。
  const namespace = (env as unknown as Record<string, unknown>)[options.doBinding] as
    | DurableObjectNamespace<HakoniwaGame>
    | undefined;
  if (namespace === undefined) {
    throw new Error(
      `hakoniwa: wrangler.jsonc の durable_objects.bindings に name: "${options.doBinding}" (class_name: "HakoniwaGame") がありません`,
    );
  }
  const id = namespace.idFromName("main");
  return namespace.get(id, { locationHint: options.locationHint });
}
