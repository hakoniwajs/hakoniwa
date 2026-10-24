// エッジのキャッシュ (Cloudflare Workers Cache) 向けの「キャッシュしてよい期間」の目安。
//
// HTML の `Cache-Control` はランタイムを問わず常に `private, no-store` のまま (app.tsx の
// defaultCacheControlMiddleware) にし、キャッシュしてよい期間は別の内部ヘッダ
// (`X-Hakoniwa-Cache-Control` / `X-Hakoniwa-Cache-Tag`) で Adapter に伝える。Cloudflare 版の
// `CachedPages` エントリポイントがこれを `Cache-Control: public, ...` / `Cache-Tag` に変換して
// Workers Cache に保存させ、ブラウザには `private, no-store` のまま返す (Issue #25)。
// ヘッダを出すのは `WebDeps.cacheHints` が true の場合だけ (Node 版は出さない)。
//
// ページの内容はゲームの状態で決まり、ターン進行 (次のターンの予定時刻) を跨ぐと変わる。
// そのため進行中のゲームは「次のターンまでの秒数 (上限 60 秒)」だけキャッシュさせる。
// 内容がもう変わらないページ (過去のゲーム) は長期 (immutable) にする。終了済みの現在の
// ゲームは、トップでも資金の最大化などで順位表が変わるため 60 秒に留める。サイト設定の変更・
// ゲームの開始/終了・データの削除・ゲーム設定・手動ターン・資金の最大化・バックアップの復元の
// ときは、Adapter がキャッシュ全体を purge する (`WebDeps.cachePurger`)。
import type { Context } from "hono";
import type { SeasonVM } from "../app/season.ts";
import type { GameHeaderVM } from "../app/view-models.ts";
import type { WebDeps } from "./deps.ts";
import type { AppEnv } from "./env.ts";

/** キャッシュしてよい期間 (`Cache-Control` のディレクティブ。`public` は付けない)。 */
export const CACHE_HINT_HEADER = "X-Hakoniwa-Cache-Control";
/** purge 用のタグ (カンマ区切り)。 */
export const CACHE_TAG_HINT_HEADER = "X-Hakoniwa-Cache-Tag";

/** 進行中・開始前・終了済み (現在のゲーム) のページをキャッシュする上限 (秒)。 */
export const SHORT_CACHE_MAX_AGE_SEC = 60;
/** 期限切れ後に古い応答を返しつつ裏で更新してよい期間 (秒)。 */
export const STALE_WHILE_REVALIDATE_SEC = 60;
/** 内容がもう変わらないページのキャッシュ期間 (1 年)。 */
export const IMMUTABLE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export interface PageCacheHintInput {
  /** トップ・観光・開発画面のどれか。 */
  page: "top" | "island" | "owner";
  game: GameHeaderVM;
  season: SeasonVM;
  /** 現在の unix 秒。 */
  now: number;
}

function shortDirectives(maxAgeSec: number): string {
  return `max-age=${maxAgeSec}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SEC}`;
}

/**
 * ゲームごとのページ (トップ・観光・開発画面) をキャッシュしてよい期間。キャッシュさせない
 * 場合は `undefined`。
 *
 * - 過去のゲーム: `max-age=31536000, immutable` (記帳も更新もできず、内容は変わらない)
 * - 終了済み (現在のゲーム): トップ・観光・開発画面とも 60 秒。トップの順位表は資金・食料の
 *   最大化で変わるため、1 年の immutable にはしない (purge に失敗しても 60 秒で消える)
 * - 終了済みの観光・開発画面は記帳も入りうる
 * - 開始前・進行中: 次のターン (開始前はゲーム開始) までの秒数。上限 60 秒。予定時刻を
 *   過ぎていれば (次のリクエストでターンが進むため) キャッシュさせない
 *
 * 期限切れ後の `stale-while-revalidate` は 60 秒 (immutable 以外)。
 */
export function pageCacheDirectives(input: PageCacheHintInput): string | undefined {
  const { game, season, now } = input;
  if (!game.isCurrent) {
    return `max-age=${IMMUTABLE_MAX_AGE_SEC}, immutable`;
  }
  const until =
    season.state === "before"
      ? season.startAt
      : season.state === "running"
        ? season.nextTurnAt
        : null;
  if (until === null) {
    return shortDirectives(SHORT_CACHE_MAX_AGE_SEC);
  }
  const remaining = until - now;
  if (remaining <= 0) {
    return undefined;
  }
  return shortDirectives(Math.min(SHORT_CACHE_MAX_AGE_SEC, remaining));
}

/** ゲーム一覧 (`/games`) をキャッシュしてよい期間。 */
export function gamesListCacheDirectives(): string {
  return shortDirectives(SHORT_CACHE_MAX_AGE_SEC);
}

/** ゲームごとのページの purge 用タグ。 */
export function gameCacheTag(gameId: number): string {
  return `game-${gameId}`;
}

/** 島ごとのページ (観光・OGP 画像) の purge 用タグ。 */
export function islandCacheTag(gameId: number, islandId: number): string {
  return `island-${gameId}-${islandId}`;
}

/** ゲーム一覧の purge 用タグ。 */
export const GAMES_LIST_CACHE_TAG = "games";

/**
 * `WebDeps.cacheHints` が true なら、応答にキャッシュの目安のヘッダを付ける。
 * `directives` が `undefined` なら何も付けない (キャッシュさせない)。
 */
export function setCacheHint(
  c: Context<AppEnv>,
  deps: Pick<WebDeps, "cacheHints">,
  directives: string | undefined,
  tags: readonly string[],
): void {
  if (deps.cacheHints !== true || directives === undefined) {
    return;
  }
  c.header(CACHE_HINT_HEADER, directives);
  c.header(CACHE_TAG_HINT_HEADER, tags.join(","));
}
