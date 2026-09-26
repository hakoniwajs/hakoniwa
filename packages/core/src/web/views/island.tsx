// Perl 版 Map.pm tempPrintIslandHead + islandInfo + islandMap(0) + tempLbbs* + tempRecent(0) の移植。
// tmp/14-users-auth.md により掲示板の記帳はログイン必須になったため、未ログイン時はログインへの
// 導線を表示する。
import type { GameConfig } from "../../core/config.ts";
import type { IslandPageVM } from "../../app/view-models.ts";
import { IslandInfo } from "./island-info.tsx";
import { IslandMap } from "./island-map.tsx";
import { LbbsContents, LbbsHead, LbbsInput } from "./lbbs.tsx";
import { LogList } from "./logs.tsx";
import { BackLink, Notice } from "./messages.tsx";

export interface IslandPageProps {
  vm: IslandPageVM;
  config: GameConfig;
  /** ローカル掲示板を表示するか (サイト設定)。 */
  useLbbs: boolean;
  /** ログイン中のみ渡ってくる (未ログインなら記帳フォームの代わりにログイン導線を出す)。 */
  csrfToken?: string | undefined;
  notice?: string;
}

/**
 * OGP メタタグ。tmp/17-ogp.md 「メタタグ」節。認証・セッションに依存しないため `Vary: Cookie` は
 * 付けない (呼び出し側 (routes/islands.tsx) も同様)。
 * `origin` は絶対 URL のベース (`config.auth.baseUrl` があればそれ、無ければリクエストのオリジン)。
 */
export function IslandOgpHead({
  vm,
  origin,
  siteTitle,
}: {
  vm: IslandPageVM;
  origin: string;
  /** サイト設定のタイトル。og:title は「<島名>島 - <サイトタイトル>」。 */
  siteTitle: string;
}) {
  // tmp/18-games.md「表示」節: og:url もゲーム ID 入りの URL にする。
  const pageUrl = `${origin}/games/${vm.game.id}/islands/${vm.id}`;
  const imageUrl = `${origin}${vm.ogp.imagePath}`;
  return (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:title" content={`${vm.name}島 - ${siteTitle}`} />
      <meta property="og:description" content={vm.ogp.description} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content={String(vm.ogp.width)} />
      <meta property="og:image:height" content={String(vm.ogp.height)} />
      <meta property="og:url" content={pageUrl} />
      <meta name="twitter:card" content="summary_large_image" />
    </>
  );
}

/** 観光画面。Perl 版 printIslandMain。 */
export function IslandPage({ vm, config, useLbbs, csrfToken, notice }: IslandPageProps) {
  return (
    <div class="island-page">
      {notice !== undefined ? <Notice message={notice} /> : ""}
      <p class="big">
        <span class="island-name">「{vm.name}島」</span>へようこそ！！
      </p>
      <BackLink gameId={vm.game.id} />

      <hr />
      <h1>島の様子</h1>
      <div class="table-scroll">
        <IslandInfo detail={vm} money={vm.moneyDisplay} config={config} />
      </div>
      <IslandMap terrain={vm.terrain} mode="visitor" turn={vm.turn} config={config} />

      {useLbbs ? (
        <>
          <hr />
          <LbbsHead islandName={vm.name} />
          {/* tmp/18-games.md: 記帳は現在のゲームのみ (過去のゲームは記帳不可)。 */}
          {!vm.game.isCurrent ? (
            <p>過去のゲームのため記帳できません。</p>
          ) : csrfToken !== undefined ? (
            <LbbsInput islandId={vm.id} gameId={vm.game.id} csrfToken={csrfToken} />
          ) : (
            <p>
              記帳するには<a href="/login">ログイン</a>してください。
            </p>
          )}
          <div class="table-scroll">
            <LbbsContents posts={vm.lbbs} />
          </div>
        </>
      ) : (
        ""
      )}

      <hr />
      <p class="big">
        <span class="island-name">{vm.name}島</span>の近況
      </p>
      <LogList logs={vm.logs} />
    </div>
  );
}
