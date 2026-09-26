// tmp/21-kv-snapshot-cache.md: 未ログイン GET のトップ/観光ページの View Model を
// Workers KV にキャッシュするための型・キー・TTL 計算。HTML はキャッシュしない
// (レンダリングは @hakoniwajs/core の renderTopPageHtml/renderIslandPageHtml を worker.ts が呼ぶ)。
import { terrainFromJSON } from "@hakoniwajs/core";
import type { IslandPageVM, SeasonState, SiteRenderSettings, TopPageVM } from "@hakoniwajs/core";

/** KV キーの版数。保存形式を変えるときはこれを上げる (invalidate 処理は作らないため)。 */
const SNAPSHOT_KEY_VERSION = "v1";

export function topSnapshotKey(gameId: number): string {
  return `${SNAPSHOT_KEY_VERSION}:${gameId}:top`;
}

export function islandSnapshotKey(gameId: number, islandId: number): string {
  return `${SNAPSHOT_KEY_VERSION}:${gameId}:island:${islandId}`;
}

/**
 * サイト設定 (タイトル・フッタ・ローカル掲示板の有無・タイムゾーン) の KV キー。
 * サイト設定は管理画面から変わるため、ページごとの View Model (過去のゲームは 30 日キャッシュ
 * する) には含めず、全ページ共通の 1 キーに短期 TTL で置く。Worker 側レンダリングは
 * View Model とこのキーの両方が KV にあるときだけ KV から応答する。
 */
export function siteSnapshotKey(): string {
  return `${SNAPSHOT_KEY_VERSION}:site`;
}

/**
 * `IslandPageVM` のうち `terrain` (クラスインスタンス) を `Terrain.toJSON()` (number[][]) に
 * 変えたもの。KV への保存にも、DO の RPC (`pageSnapshot`) の応答にも、この形を
 * 「wire 上でやり取りする形」として共通で使う (RPC はクラスインスタンスのメソッドを
 * 保ったまま渡せないため)。復元は `restoreIslandPageVM` (`terrainFromJSON`) で行う。
 */
export type IslandPageSnapshotVM = Omit<IslandPageVM, "terrain"> & { terrain: number[][] };

export function toIslandPageSnapshotVM(vm: IslandPageVM): IslandPageSnapshotVM {
  return { ...vm, terrain: vm.terrain.toJSON() };
}

/** `toIslandPageSnapshotVM` の逆変換。`islandSize` は `GameConfig.islandSize` (通常 12)。 */
export function fromIslandPageSnapshotVM(
  vm: IslandPageSnapshotVM,
  islandSize: number,
): IslandPageVM {
  return { ...vm, terrain: terrainFromJSON(islandSize, vm.terrain) };
}

/** KV に `JSON.stringify` で保存する値。設計書どおり `{ vm }` の形にする。 */
export interface SnapshotEnvelope<T> {
  vm: T;
}

export type TopPageSnapshotEnvelope = SnapshotEnvelope<TopPageVM>;
export type IslandPageSnapshotEnvelope = SnapshotEnvelope<IslandPageSnapshotVM>;

/** `siteSnapshotKey()` に `JSON.stringify` で保存する値。 */
export interface SiteSnapshotEnvelope {
  site: SiteRenderSettings;
}

/** DO の RPC `pageSnapshot` への入力。 */
export type PageSnapshotRequest =
  | { kind: "top"; gameId: number }
  | { kind: "island"; gameId: number; islandId: number };

/**
 * DO の RPC `pageSnapshot` の戻り値。ゲーム/島が存在しない場合は `undefined`
 * (呼び出し側は従来どおり DO への HTTP 転送にフォールバックする)。
 * `vm` は RPC 越しにクラスインスタンスを渡せないため、island は常に `IslandPageSnapshotVM`
 * (terrain が number[][]) にした形で返す。`site` は描画時点のサイト設定 (Worker 側レンダリングに
 * 使い、`siteSnapshotKey()` に `siteTtl` で保存する)。
 */
export type PageSnapshotResult = (
  | { kind: "top"; vm: TopPageVM; nextTurnAt: number | null; ttl: number }
  | { kind: "island"; vm: IslandPageSnapshotVM; nextTurnAt: number | null; ttl: number }
) & { site: SiteRenderSettings; siteTtl: number };

// ----------------------------------------------------------------------
// TTL (tmp/21-kv-snapshot-cache.md「キャッシュ期間の区別」節)
// ----------------------------------------------------------------------

/** Workers KV の `expirationTtl` に指定できる最小秒数。 */
const KV_MIN_TTL_SEC = 60;

const DEFAULT_TTL_SEC = 60;
/** 30 日。 */
const DEFAULT_TTL_IMMUTABLE_SEC = 60 * 60 * 24 * 30;

function parseTtlSeconds(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer (got: ${JSON.stringify(raw)})`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} is out of safe integer range (got: ${JSON.stringify(raw)})`);
  }
  // Workers KV の最小 TTL は 60 秒なので、60 未満を指定したら 60 に切り上げる。
  return Math.max(KV_MIN_TTL_SEC, value);
}

export interface SnapshotTtlEnv {
  HAKONIWA_SNAPSHOT_TTL_SEC?: string;
  HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC?: string;
}

export interface SnapshotTtlConfig {
  /** 短期 TTL (進行中/開始前のゲーム、または現在のゲームの終了済み島ページ)。既定 60 秒。 */
  ttlSec: number;
  /** 長期 TTL (過去のゲーム、または現在のゲームの終了済みトップページ)。既定 30 日。 */
  ttlImmutableSec: number;
}

export function loadSnapshotTtlConfig(env: SnapshotTtlEnv): SnapshotTtlConfig {
  return {
    ttlSec: parseTtlSeconds(
      "HAKONIWA_SNAPSHOT_TTL_SEC",
      env.HAKONIWA_SNAPSHOT_TTL_SEC,
      DEFAULT_TTL_SEC,
    ),
    ttlImmutableSec: parseTtlSeconds(
      "HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC",
      env.HAKONIWA_SNAPSHOT_TTL_IMMUTABLE_SEC,
      DEFAULT_TTL_IMMUTABLE_SEC,
    ),
  };
}

export interface ComputeSnapshotTtlInput {
  kind: "top" | "island";
  /** `vm.game.isCurrent`。false (過去のゲーム) なら記帳も含め完全に不変。 */
  isCurrent: boolean;
  /** そのゲームの `SeasonVM.state`。 */
  seasonState: SeasonState;
  /** そのゲームの `SeasonVM.nextTurnAt` (進行中でなければ null)。 */
  nextTurnAt: number | null;
  now: number;
  ttlSec: number;
  ttlImmutableSec: number;
}

/**
 * tmp/21-kv-snapshot-cache.md「キャッシュ期間の区別」節の表のとおり:
 * - 過去のゲーム (`isCurrent === false`) のトップ・島ページ: 記帳もできず完全に不変 → 長期。
 * - 現在のゲームだが終了済み (`state === 'finished'`) のトップ: 掲示板はトップに出ないので不変 → 長期。
 * - 現在のゲームだが終了済みの島ページ: 掲示板の記帳だけは入りうる → 短期。
 * - 進行中/開始前のゲームのトップ・島ページ: 短期 (次のターンまでが短ければそちらを優先)。
 */
export function computeSnapshotTtl(input: ComputeSnapshotTtlInput): number {
  const isImmutable =
    !input.isCurrent || (input.kind === "top" && input.seasonState === "finished");
  if (isImmutable) {
    return input.ttlImmutableSec;
  }
  if (input.nextTurnAt !== null) {
    return Math.max(KV_MIN_TTL_SEC, Math.min(input.ttlSec, input.nextTurnAt - input.now));
  }
  return input.ttlSec;
}
