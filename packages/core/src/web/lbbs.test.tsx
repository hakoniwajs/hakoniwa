import { describe, expect, it } from "vitest";
import { INITIAL_CLOCK, loginAs, postForm, setupTestApp } from "./test-helpers.ts";
import type { TestApp } from "./test-helpers.ts";

async function createIsland(testApp: TestApp) {
  const auth = await loginAs(testApp, {
    id: "owner1",
    name: "しまぬし",
    email: "owner1@example.com",
  });
  await postForm(
    testApp.app,
    "/games/1/islands",
    { name: "てすとじま", _csrf: auth.csrfToken },
    {
      cookie: auth.cookie,
    },
  );
  return auth;
}

describe("ローカル掲示板", () => {
  it("useLbbs=false なら 404", async () => {
    const testApp = setupTestApp({ site: { useLbbs: false } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "こんにちは", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(404);
  });

  it("未ログインでの記帳は 401", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    await createIsland(testApp);
    const res = await postForm(testApp.app, "/games/1/islands/1/lbbs", { message: "こんにちは" });
    expect(res.status).toBe(401);
  });

  it("他人の島の掲示板に観光者として記帳できる", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    await createIsland(testApp);
    const visitor = await loginAs(testApp, {
      id: "visitor1",
      name: "たびびと",
      email: "visitor1@example.com",
    });
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "こんにちは", _csrf: visitor.csrfToken },
      { cookie: visitor.cookie },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("記帳を行いました");
    expect(html).toContain("たびびと");
    expect(html).toContain("こんにちは");
    // 観光者としての記帳なので観光画面 (へようこそ) が描画される。
    expect(html).toContain("へようこそ！！");
  });

  it("島主が自分の島の掲示板 (観光ルート) に記帳すると開発画面が描画される", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "よろしく", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("記帳を行いました");
    expect(html).toContain("開発計画");
  });

  it("Origin ヘッダが host と不一致なら 403", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "こんにちは", _csrf: owner.csrfToken },
      { cookie: owner.cookie, origin: "http://evil.example.com", host: "example.com" },
    );
    expect(res.status).toBe(403);
  });

  it("Origin ヘッダが host と一致すれば 200", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "こんにちは", _csrf: owner.csrfToken },
      { cookie: owner.cookie, origin: "http://localhost:5173", host: "localhost:5173" },
    );
    expect(res.status).toBe(200);
  });

  it("島主の記帳と削除ができる", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp);
    const post = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "よろしく", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("記帳を行いました");

    const del = await postForm(
      testApp.app,
      "/games/1/my-island/lbbs/delete",
      { number: 0, _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(del.status).toBe(200);
    expect(await del.text()).toContain("記帳内容を削除しました");
  });

  it("lbbs_empty: メッセージが空なら 400", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("名前または内容の欄が空欄です");
  });

  // tmp/16-season.md「開始前の状態 = ターン 0」節「表記の原則 (ユーザー指示 2026-09-20)」: 開始前
  // (turn=0) に記帳すると、掲示板の先頭は「ターン0：」ではなく「ゲーム開始前：」と表示される。
  it("開始前 (turn=0) の記帳は「ゲーム開始前：」で表示される", async () => {
    const futureStart = INITIAL_CLOCK + 10_000;
    const testApp = setupTestApp({
      site: { useLbbs: true },
      startAt: futureStart,
      lastTime: futureStart,
    });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "よろしく", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ゲーム開始前：しまぬし &gt; よろしく");
    expect(html).not.toContain("0：しまぬし");
  });

  it("ng_word: NG ワードを含む記帳は 400", async () => {
    const testApp = setupTestApp({ site: { useLbbs: true, ngWords: ["ng"] } });
    const owner = await createIsland(testApp);
    const res = await postForm(
      testApp.app,
      "/games/1/islands/1/lbbs",
      { message: "ngだめ", _csrf: owner.csrfToken },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(400);
  });
});
