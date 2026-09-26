// Perl 版 Main.pm tempHeader/tempFooter の移植。
// ライセンス上必須の配布元リンク (tmp/01-overview.md) を本文先頭に固定で埋め込む。
// tmp/14-users-auth.md によりログイン状態のナビゲーションを追加する (Phase 6b)。
import type { Child, PropsWithChildren } from "hono/jsx";
import type { AuthUser } from "../../app/auth.ts";
import type { SiteInfo } from "../../app/site-settings.ts";

export interface LayoutProps {
  /** サイト設定のタイトル・フッタ情報 (管理画面「サイト設定」)。 */
  site: SiteInfo;
  /** ログイン中のユーザー。未ログインなら undefined。 */
  user?: AuthUser | undefined;
  /** ログアウトフォーム用。未ログインなら undefined。 */
  csrfToken?: string | undefined;
  /** `<head>` に追加する要素 (OGP メタタグ等)。tmp/17-ogp.md。 */
  extraHead?: Child | undefined;
}

const SCRIPT_SOURCE_URL = "http://www.bekkoame.ne.jp/~tokuoka/hakoniwa.html";
const REPOSITORY_URL = "https://github.com/hakoniwajs/hakoniwa";
/** 箱庭諸島の遊び方 (オリジナル版の解説ページ)。コーディネーターの追加指示によりフッタと
 * トップの「新しい島を探す」節にリンクする。 */
export const MANUAL_URL = "https://hako2d-mj.xii.jp/pin/st/manual/man01.html";

/** `http://` `https://` から始まる文字列だけリンクにする (それ以外はそのまま文字列で表示)。 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function UrlOrText({ value }: { value: string }) {
  return isHttpUrl(value) ? <a href={value}>{value}</a> : <>{value}</>;
}

/**
 * フッタ。管理者名・メール・掲示板・トップページはサイト設定が未設定 (空文字列) なら
 * 行ごと出さない。箱庭諸島のページ (配布元 URL) はライセンス上必須のため常に出す。
 */
function Footer({ site }: { site: SiteInfo }) {
  const { adminName, email, bbsUrl, topPageUrl } = site;
  const hasAdminName = adminName !== "";
  const hasEmail = email !== "";
  return (
    <p class="footer">
      {/* tmp/18-games.md「ルート」節: 現在のゲームが無くても表示する。「ナビの並び順」節:
          ナビには置かず、フッタの先頭行に移した。 */}
      <a href="/games" class="footer-games">
        過去のゲーム
      </a>
      <br />
      遊び方(
      <a href={MANUAL_URL} target="_blank" rel="noopener">
        {MANUAL_URL}
      </a>
      )<br />
      {hasAdminName || hasEmail ? (
        <>
          管理者:{hasAdminName ? adminName : ""}
          {hasEmail ? (
            <>
              (<a href={`mailto:${email}`}>{email}</a>)
            </>
          ) : (
            ""
          )}
          <br />
        </>
      ) : (
        ""
      )}
      {bbsUrl !== "" ? (
        <>
          掲示板(
          <UrlOrText value={bbsUrl} />)<br />
        </>
      ) : (
        ""
      )}
      {topPageUrl !== "" ? (
        <>
          トップページ(
          <UrlOrText value={topPageUrl} />)<br />
        </>
      ) : (
        ""
      )}
      箱庭諸島のページ(<a href={SCRIPT_SOURCE_URL}>{SCRIPT_SOURCE_URL}</a>)<br />
      TypeScript版配布(<a href={REPOSITORY_URL}>{REPOSITORY_URL}</a>)<br />
    </p>
  );
}

/**
 * ヘッダナビゲーション。タイトルへのリンクと、ログイン状態のリンク群を横並び・
 * 折り返し可能に (Phase 7 モバイル UI)。class 名 "nav*" は Phase 6b からの引き継ぎ。
 * 「ナビの並び順」節: 利用頻度順に並べる。ログイン中は 自分の島 → アカウント設定 →
 * 管理 (管理者のみ) の順で並べ、ユーザー名とログアウトは `.nav-user` にまとめて
 * `margin-left: auto` で右端に寄せる。未ログインは ログインのみ。「過去のゲーム」は
 * 利用頻度が低いためナビには置かず、フッタ先頭行に移した (Footer 参照)。
 */
function Nav({
  site,
  user,
  csrfToken,
}: {
  site: SiteInfo;
  user: AuthUser | undefined;
  csrfToken: string | undefined;
}) {
  return (
    <nav class="nav">
      <a href="/" class="nav-title">
        {site.title}
      </a>
      <div class="nav-links">
        {user === undefined ? (
          <a href="/login" class="nav-login">
            ログイン
          </a>
        ) : (
          <>
            <a href="/my-island" class="nav-my-island">
              自分の島
            </a>
            <a href="/account" class="nav-account">
              アカウント設定
            </a>
            {user.isAdmin ? (
              <a href="/admin" class="nav-admin">
                管理
              </a>
            ) : (
              ""
            )}
          </>
        )}
      </div>
      {user !== undefined ? (
        <div class="nav-user">
          <span class="nav-user-name">{user.name}さん</span>
          <form action="/logout" method="post" class="nav-logout">
            <input type="hidden" name="_csrf" value={csrfToken ?? ""} />
            <input type="submit" value="ログアウト" />
          </form>
        </div>
      ) : (
        ""
      )}
    </nav>
  );
}

export function Layout({
  site,
  user,
  csrfToken,
  extraHead,
  children,
}: PropsWithChildren<LayoutProps>) {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{site.title}</title>
        <link rel="stylesheet" href="/style.css" />
        {extraHead ?? ""}
      </head>
      <body>
        <p class="distribution-link">
          <a href={SCRIPT_SOURCE_URL}>箱庭諸島スクリプト配布元</a>
        </p>
        <Nav site={site} user={user} csrfToken={csrfToken} />
        <main>{children}</main>
        <hr />
        <Footer site={site} />
      </body>
    </html>
  );
}
