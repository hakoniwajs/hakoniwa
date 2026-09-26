// tmp/21-kv-snapshot-cache.md「テスト」節の 5 項目 + 「キャッシュ期間の区別」節の TTL 選択を
// 確認する。`packages/cloudflare/src/worker.ts` の `export default` (`fetch`) を直接呼び出し、
// KV スナップショットキャッシュの経路を検証する (他のテストファイルのように DO の `fetch` を
// 直接叩くだけでは worker.ts のキャッシュ経路を経由しないため)。
//
// `worker.ts` の `getGame()` は常に `env.GAME.idFromName("main")` を使う (本番は世界が 1 つの
// ため) ので、このファイル内のテストはすべて同じ DO インスタンス ("main") を共有する。
// `afterEach` で `reset()` (KV・DO のデータを含め全バインディングをリセットする) を呼び、
// 各テストを独立させる。
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/worker.ts";
import { islandSnapshotKey, siteSnapshotKey, topSnapshotKey } from "../src/snapshot.ts";
import type { Env } from "../src/env.ts";

afterEach(async () => {
  await reset();
});

function mainGameStub() {
  const id = env.GAME.idFromName("main");
  return env.GAME.get(id);
}

/** `worker.ts` の `export default.fetch` を直接呼ぶ (Worker のトップレベルの経路)。 */
async function fetchWorker(
  url: string,
  init?: RequestInit,
  overrideEnv: Env = env,
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), overrideEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** 開発ログイン (管理者) して Cookie と管理画面の CSRF トークンを取り出す。DO への直接 fetch。 */
async function loginAsAdmin(): Promise<{ cookie: string; csrfToken: string }> {
  const stub = mainGameStub();
  const loginRes = await stub.fetch("http://example.com/auth/dev", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=admin%40example.com",
    redirect: "manual",
  });
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) {
    throw new Error("login failed");
  }
  const adminRes = await stub.fetch("http://example.com/admin", { headers: { cookie } });
  const csrfToken = (await adminRes.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (csrfToken === undefined) {
    throw new Error("csrf token not found");
  }
  return { cookie, csrfToken };
}

/** ゲームを開始する (DO への直接 fetch)。既定 (start-at 省略) なら即座に開始扱いになる。 */
async function startGame(cookie: string, csrfToken: string): Promise<void> {
  const stub = mainGameStub();
  const res = await stub.fetch("http://example.com/admin/games", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `_csrf=${encodeURIComponent(csrfToken)}`,
  });
  if (res.status !== 200) {
    throw new Error(`startGame failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * 島を作成する (DO への直接 fetch。ログイン中のユーザーが所有者になる)。
 * `NewIslandPage` のレスポンスに島 ID へのリンクが無いため ID は返さない。各テストは
 * `reset()` 後の新しい "main" DO ・新しいゲームに対して 1 つだけ島を作る前提で、
 * 最初の島の ID は常に 1 になる (`cache-control.test.ts` 等、既存のテストと同じ前提)。
 */
async function createIsland(
  cookie: string,
  csrfToken: string,
  gameId: number,
  name: string,
): Promise<void> {
  const stub = mainGameStub();
  const res = await stub.fetch(`http://example.com/games/${gameId}/islands`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `name=${encodeURIComponent(name)}&_csrf=${encodeURIComponent(csrfToken)}`,
  });
  if (res.status !== 200) {
    throw new Error(`createIsland failed: ${res.status} ${await res.text()}`);
  }
}

/** 管理画面の「サイト設定」を保存する (DO への直接 fetch)。 */
async function saveSiteSettings(
  cookie: string,
  csrfToken: string,
  fields: Record<string, string>,
): Promise<void> {
  const stub = mainGameStub();
  const body = new URLSearchParams({ timezone: "Asia/Tokyo", ...fields, _csrf: csrfToken });
  const res = await stub.fetch("http://example.com/admin/site-settings", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (res.status !== 200) {
    throw new Error(`saveSiteSettings failed: ${res.status} ${await res.text()}`);
  }
}

/** 島主本人としてコメントを更新する (DO への直接 fetch)。 */
async function updateComment(
  cookie: string,
  csrfToken: string,
  gameId: number,
  comment: string,
): Promise<void> {
  const stub = mainGameStub();
  const res = await stub.fetch(`http://example.com/games/${gameId}/my-island/comment`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `message=${encodeURIComponent(comment)}&_csrf=${encodeURIComponent(csrfToken)}`,
  });
  if (res.status !== 200) {
    throw new Error(`updateComment failed: ${res.status} ${await res.text()}`);
  }
}

describe("KV スナップショットキャッシュ (tmp/21-kv-snapshot-cache.md)", () => {
  it("1. 未ログイン GET /games/:id は 1 回目 miss (KV に書く)、2 回目 hit (DO の最新値ではなく古い値が返る)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "いちごう");
    const islandId = 1;
    await updateComment(cookie, csrfToken, 1, "さいしょのコメント");

    const first = await fetchWorker("http://example.com/games/1");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    const firstHtml = await first.text();
    expect(firstHtml).toContain("さいしょのコメント");

    // KV に書かれていることを直接確認する。
    const stored = await env.SNAPSHOT?.get(topSnapshotKey(1));
    expect(stored).not.toBeNull();
    expect(stored).toBeDefined();

    // 別のリクエスト (認証あり。DO へ直接行く) でコメントを更新する。キャッシュは invalidate
    // されない (設計どおり) ため、KV には古い値が残る。
    await updateComment(cookie, csrfToken, 1, "あたらしいコメント");
    // DO 側では既に更新されていることを確認 (認証ありは常に DO へ行く。2. の確認を兼ねる)。
    const authedRes = await fetchWorker("http://example.com/games/1", { headers: { cookie } });
    expect(authedRes.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");
    expect(await authedRes.text()).toContain("あたらしいコメント");

    // 未ログインの 2 回目は KV から返り (hit)、DO の最新値 (あたらしいコメント) ではなく
    // 1 回目にキャッシュした古い値のままになる。
    const second = await fetchWorker("http://example.com/games/1");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Hakoniwa-Snapshot")).toBe("hit");
    const secondHtml = await second.text();
    expect(secondHtml).toContain("さいしょのコメント");
    expect(secondHtml).not.toContain("あたらしいコメント");

    // 島ページも同様に miss → hit で古い値が返ることを確認する。
    const islandFirst = await fetchWorker(`http://example.com/games/1/islands/${islandId}`);
    expect(islandFirst.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    const islandKey = islandSnapshotKey(1, islandId);
    expect(await env.SNAPSHOT?.get(islandKey)).not.toBeNull();
    const islandSecond = await fetchWorker(`http://example.com/games/1/islands/${islandId}`);
    expect(islandSecond.headers.get("X-Hakoniwa-Snapshot")).toBe("hit");
  });

  it("2. セッション Cookie 付きの GET は常に DO へ行く (bypass。KV の値は使われない)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    // 先に未ログインでキャッシュを作っておく。
    const cached = await fetchWorker("http://example.com/games/1");
    expect(cached.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");

    const authedRes = await fetchWorker("http://example.com/games/1", { headers: { cookie } });
    expect(authedRes.status).toBe(200);
    expect(authedRes.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");
    // ログイン中のみ出るナビ (自分の島へのリンク) が含まれる = DO からそのまま返っている証拠。
    expect(await authedRes.text()).toContain('href="/my-island"');
  });

  it("3. env.SNAPSHOT 未バインドでも 200 が返る (常に DO へ転送)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    // `exactOptionalPropertyTypes` があるため `SNAPSHOT: undefined` は入れられない
    // (`Env.SNAPSHOT` は optional であって `| undefined` ではないため)。分割代入でプロパティ
    // 自体を落とし、未バインドの状態を再現する。
    const { SNAPSHOT: _snapshot, ...envWithoutSnapshot } = env;
    const res = await fetchWorker("http://example.com/games/1", undefined, envWithoutSnapshot);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");
    expect(await res.text()).toContain("諸島の状況");
  });

  it("4. Worker が返す HTML が DO が返す HTML と一致する (トップ・島ページ)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "にごう");
    const islandId = 1;

    // トップページ: 同時期に Worker 経由 (キャッシュ miss → RPC + レンダリング) と
    // DO 直接 (通常の HTML レンダリング) の両方を叩いて比較する。
    const workerTop = await fetchWorker("http://example.com/games/1");
    expect(workerTop.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    const workerTopHtml = await workerTop.text();
    const doTopHtml = await (await mainGameStub().fetch("http://example.com/games/1")).text();
    expect(workerTopHtml).toBe(doTopHtml);

    // 島ページも同様に比較する (terrain の JSON 往復を経由したレンダリングであることが重要)。
    const workerIsland = await fetchWorker(`http://example.com/games/1/islands/${islandId}`);
    expect(workerIsland.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    const workerIslandHtml = await workerIsland.text();
    const doIslandHtml = await (
      await mainGameStub().fetch(`http://example.com/games/1/islands/${islandId}`)
    ).text();
    expect(workerIslandHtml).toBe(doIslandHtml);
  });

  it("5. POST や /games/:id/my-island はキャッシュ経路に入らない (bypass)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    const postRes = await fetchWorker("http://example.com/games/1/islands", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${encodeURIComponent("さんごう")}&_csrf=x`,
    });
    expect(postRes.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");

    const myIslandRes = await fetchWorker("http://example.com/games/1/my-island");
    expect(myIslandRes.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");

    // クエリ文字列付きの GET /games/:id も対象外 (bypass) にする。
    const withQuery = await fetchWorker("http://example.com/games/1?notice=no_island");
    expect(withQuery.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");
  });

  it("応答の Cache-Control は HTML なので private, no-store のまま (hit/miss/bypass 共通)", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);

    const miss = await fetchWorker("http://example.com/games/1");
    expect(miss.headers.get("Cache-Control")).toBe("private, no-store");
    const hit = await fetchWorker("http://example.com/games/1");
    expect(hit.headers.get("X-Hakoniwa-Snapshot")).toBe("hit");
    expect(hit.headers.get("Cache-Control")).toBe("private, no-store");
    const bypass = await fetchWorker("http://example.com/games/1", { headers: { cookie } });
    expect(bypass.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it(
    "TTL: 過去のゲーム/終了済みトップは長期、進行中・終了済み島ページは短期になる " +
      "(DO の RPC pageSnapshot を直接叩いて確認する)",
    async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const stub = mainGameStub();

      // ゲーム 1: 開始してすぐ running にする (turn-check を待たず checkTurn() で確定させる)。
      await startGame(cookie, csrfToken);
      await stub.checkTurn();
      await createIsland(cookie, csrfToken, 1, "よんごう");
      const islandId = 1;

      const runningTop = await stub.pageSnapshot({ kind: "top", gameId: 1 });
      const runningIsland = await stub.pageSnapshot({ kind: "island", gameId: 1, islandId });
      // 既定の 1 ターンの長さ (21600 秒) は既定の HAKONIWA_SNAPSHOT_TTL_SEC (60) より
      // 十分大きいため、進行中は ttlSec (60) がそのまま採用される。
      expect(runningTop?.ttl).toBe(60);
      expect(runningIsland?.ttl).toBe(60);

      // 現在のゲームを終了する (isCurrent のまま season.state だけ 'finished' になる)。
      const finishRes = await stub.fetch("http://example.com/admin/games/current/finish", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: `confirm=on&_csrf=${encodeURIComponent(csrfToken)}`,
      });
      expect(finishRes.status).toBe(200);

      const finishedTop = await stub.pageSnapshot({ kind: "top", gameId: 1 });
      const finishedIsland = await stub.pageSnapshot({ kind: "island", gameId: 1, islandId });
      // 終了済みのトップは (掲示板が出ないため) 不変 → 長期 TTL。
      expect(finishedTop?.ttl).toBe(2_592_000);
      // 終了済みでも島ページは記帳が入りうるため短期 TTL のまま。
      expect(finishedIsland?.ttl).toBe(60);

      // ゲーム 2 を開始する (現在のゲームが終了しているので開始できる)。ゲーム 1 は
      // isCurrent === false (過去のゲーム) になる。
      const startGame2Res = await stub.fetch("http://example.com/admin/games", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: `_csrf=${encodeURIComponent(csrfToken)}`,
      });
      expect(startGame2Res.status).toBe(200);

      const pastTop = await stub.pageSnapshot({ kind: "top", gameId: 1 });
      const pastIsland = await stub.pageSnapshot({ kind: "island", gameId: 1, islandId });
      // 過去のゲームは記帳もできず完全に不変 → トップ・島ページとも長期 TTL。
      expect(pastTop?.ttl).toBe(2_592_000);
      expect(pastIsland?.ttl).toBe(2_592_000);
    },
  );

  it("サイト設定 (管理画面) は DO から受け取って KV の共通キーに置き、Worker 側レンダリングに使う", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "ごごう");
    await saveSiteSettings(cookie, csrfToken, {
      title: "かんりがめんのしま",
      "admin-name": "かんりにん",
      "use-lbbs": "on",
    });

    const miss = await fetchWorker("http://example.com/games/1");
    expect(miss.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    const missHtml = await miss.text();
    expect(missHtml).toContain("<title>かんりがめんのしま</title>");
    expect(missHtml).toContain("管理者:かんりにん");
    // サイト設定の KV キーには NG ワードを含めない (描画に必要なものだけ)。
    const storedSite = await env.SNAPSHOT?.get<{ site: Record<string, unknown> }>(
      siteSnapshotKey(),
      "json",
    );
    expect(storedSite?.site).toMatchObject({ title: "かんりがめんのしま", useLbbs: true });
    expect(storedSite?.site).not.toHaveProperty("ngWords");

    // 島ページ (ローカル掲示板の有無・OGP タイトルもサイト設定に従う)。
    const island = await fetchWorker("http://example.com/games/1/islands/1");
    const islandHtml = await island.text();
    expect(islandHtml).toContain('content="ごごう島 - かんりがめんのしま"');
    expect(islandHtml).toContain("観光者通信");

    // サイト設定を変えても、KV のサイト設定が残っている間 (短期 TTL) は古い値で hit する。
    await saveSiteSettings(cookie, csrfToken, { title: "あたらしいたいとる" });
    const hit = await fetchWorker("http://example.com/games/1");
    expect(hit.headers.get("X-Hakoniwa-Snapshot")).toBe("hit");
    expect(await hit.text()).toContain("<title>かんりがめんのしま</title>");

    // サイト設定のキーが期限切れになれば (ここでは削除で再現)、ページの View Model が KV に
    // 残っていても DO から取り直し、新しいサイト設定で描画する。
    await env.SNAPSHOT?.delete(siteSnapshotKey());
    const refreshed = await fetchWorker("http://example.com/games/1");
    expect(refreshed.headers.get("X-Hakoniwa-Snapshot")).toBe("miss");
    expect(await refreshed.text()).toContain("<title>あたらしいたいとる</title>");
  });

  it("対象のゲーム/島が無ければ pageSnapshot は undefined を返し、DO への通常経路にフォールバックする", async () => {
    const res = await fetchWorker("http://example.com/games/999");
    // KV にもゲームにも無いので DO への通常の fetch にフォールバックし、いつもどおりの
    // エラー画面 (game_not_found) になる。
    expect(res.status).not.toBe(200);
    expect(res.headers.get("X-Hakoniwa-Snapshot")).toBe("bypass");
  });
});
