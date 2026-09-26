// tmp/21-kv-snapshot-cache.md: 読み取り専用ページの View Model を Workers KV にキャッシュし、
// Worker 側でレンダリングして Durable Object への往復を省く機能のための、ランタイム非依存な
// レンダリング関数。DO 側 (routes/render.tsx の renderPage + views/layout.tsx の Layout) と
// 同じ JSX を、Context に依存せず (user/csrfToken 無し = 未ログイン扱い) 描画する。
// hono/jsx から HTML 文字列を得る方法は `c.html()` (hono の Context) の実装
// (`resolveCallback(jsxElement, HtmlEscapedCallbackPhase.Stringify, false, {})`) と同じにして、
// 出力が一致することを保証する。
import { HtmlEscapedCallbackPhase, resolveCallback } from "hono/utils/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { GameConfig } from "../core/config.ts";
import type { SiteRenderSettings } from "../app/site-settings.ts";
import type { IslandPageVM, TopPageVM } from "../app/view-models.ts";
import { IslandOgpHead, IslandPage } from "./views/island.tsx";
import { Layout } from "./views/layout.tsx";
import { TopPage } from "./views/top.tsx";

/** hono/jsx の要素 (`JSX.Element` = `HtmlEscapedString | Promise<HtmlEscapedString>`) の型。 */
type JsxElement = HtmlEscapedString | Promise<HtmlEscapedString>;

/** `c.html(jsxElement)` と同じ処理を Context 無しで行う。 */
function renderJsxToHtml(node: JsxElement): Promise<string> {
  return resolveCallback(node, HtmlEscapedCallbackPhase.Stringify, false, {});
}

export interface RenderTopPageHtmlInput {
  vm: TopPageVM;
  config: GameConfig;
  /**
   * 描画時点のサイト設定 (タイトル・フッタ・タイムゾーン等)。管理画面から変わるため、
   * Worker 側では DO から受け取ったもの (KV にキャッシュしたもの) を渡す。
   */
  site: SiteRenderSettings;
  /** 表示時点の unix 秒。「次のターンまであと N 分」の計算に使う。 */
  now: number;
}

/**
 * `GET /games/:gameId` (トップ) を未ログイン扱いで描画する。`routes/top.tsx` の
 * `createGameTopRoutes` と同じ JSX (`Layout` + `TopPage`) を、`user`/`csrfToken` を
 * `undefined` にして使う (未ログインの実際のレスポンスに CSRF トークンやフォームが
 * 無いことは tmp/21-kv-snapshot-cache.md で確認済み)。
 */
export function renderTopPageHtml({
  vm,
  config,
  site,
  now,
}: RenderTopPageHtmlInput): Promise<string> {
  return renderJsxToHtml(
    <Layout site={site} user={undefined} csrfToken={undefined}>
      <TopPage vm={vm} config={config} timezone={site.timezone} now={now} />
    </Layout>,
  );
}

export interface RenderIslandPageHtmlInput {
  vm: IslandPageVM;
  config: GameConfig;
  /** 描画時点のサイト設定 (`RenderTopPageHtmlInput.site` と同じ)。 */
  site: SiteRenderSettings;
  /** OGP メタタグの絶対 URL 化に使うオリジン (`config.auth.baseUrl` かリクエストのオリジン)。 */
  origin: string;
}

/**
 * `GET /games/:gameId/islands/:id` (観光) を未ログイン扱いで描画する。`routes/islands.tsx` と
 * 同じ JSX (`Layout` + `IslandPage`、`extraHead` に `IslandOgpHead`) を、`user`/`csrfToken` を
 * `undefined` にして使う。
 */
export function renderIslandPageHtml({
  vm,
  config,
  site,
  origin,
}: RenderIslandPageHtmlInput): Promise<string> {
  return renderJsxToHtml(
    <Layout
      site={site}
      user={undefined}
      csrfToken={undefined}
      extraHead={<IslandOgpHead vm={vm} origin={origin} siteTitle={site.title} />}
    >
      <IslandPage vm={vm} config={config} useLbbs={site.useLbbs} csrfToken={undefined} />
    </Layout>,
  );
}
