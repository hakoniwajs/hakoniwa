// tmp/18-games.md「ルート」節: GET /games (一覧)、旧 URL のリダイレクト、複数ゲームのライフサイクル
// (終了 → 新しいゲーム開始 → 過去のゲームは読み取り専用) の web 層テスト。
import { describe, expect, it } from "vitest";
import { currentGameId, loginAs, postForm, setupTestApp } from "./test-helpers.ts";
import type { TestApp } from "./test-helpers.ts";

async function createIsland(testApp: TestApp, user: { id: string; name: string; email: string }) {
  const auth = await loginAs(testApp, user);
  const gameId = currentGameId(testApp);
  const res = await postForm(
    testApp.app,
    `/games/${gameId}/islands`,
    { name: "てすとじま", _csrf: auth.csrfToken },
    { cookie: auth.cookie },
  );
  return { res, auth, gameId };
}

describe("GET /games (ゲーム一覧)", () => {
  it("ゲームが無くても 200 で空一覧を表示する", async () => {
    const { app } = setupTestApp({ skipInit: true });
    const res = await app.request("/games");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("まだゲームがありません");
  });

  it("現在のゲームに「(現在)」を付け、名前が /games/:id へのリンクになる", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a href="/games/1">第 1 回</a>(現在)');
  });

  it("フッタに「過去のゲーム」リンクがある (ゲームが無くても)", async () => {
    const { app } = setupTestApp({ skipInit: true });
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('<a href="/games" class="footer-games">');
    expect(html).toContain("過去のゲーム");
    // コーディネーターの追加指示: 遊び方リンクも常に表示する (ゲームが無くても)。
    expect(html).toContain('href="https://hako2d-mj.xii.jp/pin/st/manual/man01.html"');
  });
});

describe("旧 URL は現在のゲームへ 302 (シェア済み URL 対策)", () => {
  it("GET /my-island は /games/:current/my-island へ 302", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/my-island", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/games/1/my-island");
  });

  it("GET /islands/:id は /games/:current/islands/:id へ 302", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    const res = await testApp.app.request("/islands/1", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/games/1/islands/1");
  });

  it("GET /islands/:id/ogp.png は /games/:current/islands/:id/ogp.png へ 302 (クエリも保持)", async () => {
    const testApp = setupTestApp();
    await createIsland(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    const res = await testApp.app.request("/islands/1/ogp.png?turn=1", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/games/1/islands/1/ogp.png?turn=1");
  });
});

describe("存在しない gameId", () => {
  it("GET /games/:id (存在しない) は 404", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/999");
    expect(res.status).toBe(404);
  });

  it("GET /games/:id/islands/:id (存在しないゲーム) は 404", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/999/islands/1");
    expect(res.status).toBe(404);
  });

  it("GET /games/:id/my-island (存在しないゲーム) は 404 (ゲームの存在確認が先)", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/999/my-island");
    expect(res.status).toBe(404);
  });
});

describe("tmp/18-games.md: ゲームの終了 → 新しいゲーム開始 → 過去のゲームは読み取り専用", () => {
  it("終了後も過去のゲームは閲覧でき、書き込みは 409。新しいゲームでは同じユーザーが島を作れる", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp, {
      id: "owner1",
      name: "しまぬし",
      email: "owner1@example.com",
    });
    expect(owner.res.status).toBe(200);

    // ゲーム 1 を終了する (この時点では game 2 が無いのでまだ「現在のゲーム」)。
    testApp.repo.finishGame(1, testApp.clock.now());

    // 終了直後もトップ・観光・開発画面はまだ見られる。
    const finishedTop = await testApp.app.request("/games/1");
    expect(finishedTop.status).toBe(200);
    const finishedTopHtml = await finishedTop.text();
    expect(finishedTopHtml).toContain("結果発表");
    // 「このゲームは終了しています。」は「過去の (現在でない) ゲーム」向けの文言であり、
    // isCurrent のまま終了しただけの現在のゲームには表示しない (top.test.tsx で確認済み)。
    expect(finishedTopHtml).not.toContain("このゲームは終了しています。");

    const finishedIsland = await testApp.app.request("/games/1/islands/1");
    expect(finishedIsland.status).toBe(200);

    const finishedOwner = await testApp.app.request("/games/1/my-island", {
      headers: { cookie: owner.auth.cookie },
    });
    expect(finishedOwner.status).toBe(200);
    expect(await finishedOwner.text()).not.toContain('action="/games/1/my-island/commands"');

    // 終了した現在のゲームへの計画登録は 409 (game_finished)。
    const writeRes = await postForm(
      testApp.app,
      "/games/1/my-island/commands",
      {
        _csrf: owner.auth.csrfToken,
        number: 0,
        kind: 1,
        x: 0,
        y: 0,
        amount: 0,
        target: 0,
        mode: "insert",
      },
      { cookie: owner.auth.cookie },
    );
    expect(writeRes.status).toBe(409);

    // 記帳は「現在のゲーム」であれば終了後も許可される (tmp/16-season.md)。
    const lbbsRes = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { _csrf: owner.auth.csrfToken, message: "感想です" },
      { cookie: owner.auth.cookie },
    );
    expect(lbbsRes.status).toBe(200);

    // 新しいゲームを開始する (AdminService 経由)。
    const newGameId = testApp.adminService.startGame({}, testApp.clock.now());
    expect(newGameId).toBe(2);

    // / は新しいゲームへ 302。
    const root = await testApp.app.request("/", { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/games/2");

    // 過去のゲーム (1) は引き続き 200 で見られ、今度は「このゲームは終了しています。」を表示する。
    const pastTop = await testApp.app.request("/games/1");
    expect(pastTop.status).toBe(200);
    expect(await pastTop.text()).toContain("このゲームは終了しています。");

    const pastAfterNewGame = await testApp.app.request("/games/1/islands/1");
    expect(pastAfterNewGame.status).toBe(200);
    const pastOgp = await testApp.app.request("/games/1/islands/1/ogp.png");
    expect(pastOgp.status).toBe(200);
    expect(pastOgp.headers.get("content-type")).toBe("image/png");

    // 過去の (現在でない) ゲームには記帳できない。
    const pastLbbsRes = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { _csrf: owner.auth.csrfToken, message: "もう終わったゲームへの感想" },
      { cookie: owner.auth.cookie },
    );
    expect(pastLbbsRes.status).toBe(409);

    // 同じユーザーが新しいゲームで島を作れる (ゲームごとに 1 ユーザー 1 島)。
    const createInNewGame = await postForm(
      testApp.app,
      "/games/2/islands",
      { name: "にばんめのしま", _csrf: owner.auth.csrfToken },
      { cookie: owner.auth.cookie },
    );
    expect(createInNewGame.status).toBe(200);
    expect(await createInNewGame.text()).toContain("「にばんめのしま島」");

    // ゲーム一覧に 2 件表示される。
    const gamesList = await testApp.app.request("/games");
    const gamesHtml = await gamesList.text();
    expect(gamesHtml).toContain('<a href="/games/1">第 1 回</a>');
    expect(gamesHtml).toContain('<a href="/games/2">第 2 回</a>(現在)');
  });
});
