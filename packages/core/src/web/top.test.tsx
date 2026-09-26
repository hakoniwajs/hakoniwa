import { describe, expect, it } from "vitest";
import {
  INITIAL_CLOCK,
  currentGameId,
  currentMeta,
  loginAs,
  postForm,
  setupTestApp,
} from "./test-helpers.ts";

describe("GET / (tmp/18-games.md: 現在のゲームへ 302)", () => {
  it("ゲームがあれば /games/:id へ 302", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/games/1");
  });

  it("ゲームが無ければ200で「ゲームはまだ開始されていません」を表示する (管理者以外は /admin 案内なし)", async () => {
    const { app } = setupTestApp({ skipInit: true });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ゲームはまだ開始されていません");
    expect(html).not.toContain('href="/admin"');
  });

  it("ゲームが無い場合、管理者には /admin への案内を表示する", async () => {
    const testApp = setupTestApp({ skipInit: true, adminEmails: ["admin@example.com"] });
    const auth = await loginAs(testApp, {
      id: "admin1",
      name: "かんりしゃ",
      email: "admin@example.com",
    });
    const res = await testApp.app.request("/", { headers: { cookie: auth.cookie } });
    const html = await res.text();
    expect(html).toContain('href="/admin"');
  });
});

describe("GET /games/:gameId (トップ)", () => {
  it("200 で配布元リンク、ゲーム名、ターン数、各見出しを含む (未ログイン)", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("http://www.bekkoame.ne.jp/~tokuoka/hakoniwa.html");
    expect(html).toContain("箱庭諸島スクリプト配布元");
    expect(html).toContain("<h1>第 1 回</h1>");
    expect(html).toContain("<h2>ターン 1</h2>");
    expect(html).toContain("自分の島へ");
    expect(html).toContain("諸島の状況");
    expect(html).toContain("最近の出来事");
    expect(html).toContain("発見の記録");
    expect(html).toContain("ログイン");
    // コーディネーターの追加指示: 未ログインでもログイン誘導の近くに遊び方リンクを出す。
    expect(html).toContain("箱庭諸島の遊び方");
  });

  it("存在しない gameId は 404", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/999");
    expect(res.status).toBe(404);
  });

  it("ログイン済みで島未所持なら「新しい島を探す」フォームを含む", async () => {
    const testApp = setupTestApp();
    const { cookie } = await loginAs(testApp, {
      id: "u1",
      name: "たろう",
      email: "u1@example.com",
    });
    const res = await testApp.app.request("/games/1", { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain("新しい島を探す");
    expect(html).toContain('action="/games/1/islands"');
    expect(html).not.toContain('action="/my-island"');
    // コーディネーターの追加指示: 遊び方リンクをフォームの上に表示する。
    expect(html).toContain("箱庭諸島の遊び方");
  });

  it("ログイン済みで島所持なら「自分の島の開発計画へ」リンクを含む", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすと", _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    const res = await testApp.app.request("/games/1", { headers: { cookie: auth.cookie } });
    const html = await res.text();
    expect(html).toContain("自分の島の開発計画へ");
    expect(html).not.toContain("新しい島を探す");
  });

  it("debug=false ならターンを進めるボタンを含まない", async () => {
    const { app } = setupTestApp({ debug: false });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).not.toContain("ターンを進める");
  });

  it("debug=true ならターンを進めるボタンを含む", async () => {
    const { app } = setupTestApp({ debug: true });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("ターンを進める");
  });

  it("順位表の島名: absent === 0 なら island-name クラスで、ゲーム ID 入りのリンクにする", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすと", _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    const island = testApp.repo.findIsland(currentGameId(testApp), 1);
    if (island === undefined) {
      throw new Error("island not found");
    }
    testApp.repo.updateIsland(currentGameId(testApp), { ...island, absent: 0 });

    const res = await testApp.app.request("/games/1");
    const html = await res.text();
    expect(html).toContain('class="island-name"');
    expect(html).not.toContain('class="island-name-faded"');
    expect(html).toContain('href="/games/1/islands/1"');
  });

  it("順位表の島名: absent > 0 なら island-name-faded クラスで薄く表示する", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすと", _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    const island = testApp.repo.findIsland(currentGameId(testApp), 1);
    if (island === undefined) {
      throw new Error("island not found");
    }
    testApp.repo.updateIsland(currentGameId(testApp), { ...island, absent: 25 });

    const res = await testApp.app.request("/games/1");
    const html = await res.text();
    expect(html).toContain('class="island-name-faded"');
    expect(html).toContain("てすと島(25)");
  });

  // tmp/19-abandon.md「表示」節。
  it("順位表の島名: 放棄済みなら「(放棄)」を付け、island-name-faded クラスで表示する", async () => {
    const testApp = setupTestApp();
    const auth = await loginAs(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    await postForm(
      testApp.app,
      "/games/1/islands",
      { name: "てすと", _csrf: auth.csrfToken },
      { cookie: auth.cookie },
    );
    await postForm(
      testApp.app,
      "/games/1/my-island/abandon",
      { confirm: "on", _csrf: auth.csrfToken },
      { cookie: auth.cookie },
    );

    const res = await testApp.app.request("/games/1");
    const html = await res.text();
    expect(html).toContain('class="island-name-faded"');
    expect(html).toContain("てすと島(放棄)");
  });
});

describe("フッタ", () => {
  it("管理者名・メール・掲示板・トップページ URL が未設定なら該当行を表示しない (配布元リンクは常に表示)", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).not.toContain("管理者:");
    expect(html).not.toContain("掲示板(");
    expect(html).not.toContain("トップページ(");
    expect(html).toContain("箱庭諸島のページ(");
    expect(html).toContain('TypeScript版配布(<a href="https://github.com/hakoniwajs/hakoniwa">');
    // コーディネーターの追加指示: 遊び方 (外部サイト) へのリンク。
    expect(html).toContain("遊び方(");
    expect(html).toContain('href="https://hako2d-mj.xii.jp/pin/st/manual/man01.html"');
  });

  it("管理者名だけ設定なら「管理者:名前」のみ表示する (メールの括弧は付かない)", async () => {
    const { app } = setupTestApp({
      site: { adminName: "かんりしゃ" },
    });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("管理者:かんりしゃ");
    expect(html).not.toContain("管理者:かんりしゃ(");
  });

  it("メールだけ設定なら「管理者:(mailto リンク)」を表示する", async () => {
    const { app } = setupTestApp({
      site: { email: "admin@example.com" },
    });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain('管理者:(<a href="mailto:admin@example.com">admin@example.com</a>)');
  });

  it("すべて設定されていれば管理者・掲示板・トップページの行を表示する", async () => {
    const { app } = setupTestApp({
      site: {
        adminName: "かんりしゃ",
        email: "admin@example.com",
        bbsUrl: "https://example.com/bbs",
        topPageUrl: "https://example.com/",
      },
    });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain(
      '管理者:かんりしゃ(<a href="mailto:admin@example.com">admin@example.com</a>)',
    );
    expect(html).toContain('掲示板(<a href="https://example.com/bbs">https://example.com/bbs</a>)');
    expect(html).toContain('トップページ(<a href="https://example.com/">https://example.com/</a>)');
  });

  it("http(s) で始まらない掲示板 URL はリンクにせず文字列のまま表示する", async () => {
    const { app } = setupTestApp({
      site: { bbsUrl: "掲示板は別紙参照" },
    });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("掲示板(掲示板は別紙参照)");
    expect(html).not.toContain('<a href="掲示板は別紙参照"');
  });
});

describe("POST /turn (デバッグ用)", () => {
  it("debug=false なら 404", async () => {
    const { app } = setupTestApp({ debug: false });
    const res = await app.request("/turn", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("debug=true でも未ログインなら 401", async () => {
    const { app } = setupTestApp({ debug: true });
    const res = await app.request("/turn", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("debug=true でも管理者でなければ 403", async () => {
    const testApp = setupTestApp({ debug: true });
    const auth = await loginAs(testApp, { id: "u1", name: "たろう", email: "u1@example.com" });
    const res = await postForm(
      testApp.app,
      "/turn",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(403);
  });

  it("debug=true かつ管理者なら 200 でターンが進みトップを再描画する", async () => {
    const testApp = setupTestApp({ debug: true, adminEmails: ["admin@example.com"] });
    const auth = await loginAs(testApp, {
      id: "admin1",
      name: "かんりしゃ",
      email: "admin@example.com",
    });
    const res = await postForm(
      testApp.app,
      "/turn",
      { _csrf: auth.csrfToken },
      {
        cookie: auth.cookie,
      },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h2>ターン 2</h2>");
    expect(currentMeta(testApp).turn).toBe(2);
  });
});

describe("tmp/16-season.md: トップの3状態 (開始前/進行中/終了)", () => {
  it("進行中: 見出しは「ターン N / 最終ターン M」、次のターン・ターン間隔は table.turn-info で表示する", async () => {
    const { app } = setupTestApp({ finalTurn: 10 });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("<h2>ターン 1 / 10</h2>");
    expect(html).toContain('<table class="turn-info">');
    expect(html).toContain("<th>次のターン</th>");
    // unitTimeSec は既定の 21600 秒 (6時間)、lastTime === startAt === now なので残り時間はちょうど 6時間。
    expect(html).toContain("(あと 6時間)");
    expect(html).toContain("<th>ターン間隔</th>");
    expect(html).toContain("<td>6時間</td>");
    expect(html).not.toContain("結果発表");
    expect(html).not.toContain("<th>ゲーム開始</th>");
    expect(html).not.toContain("このゲームは終了しています。");
  });

  it("最終ターンが無ければ見出しは「ターン N」のみ (「/」を付けない)", async () => {
    const { app } = setupTestApp();
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("<h2>ターン 1</h2>");
  });

  it("tmp/16-season.md: 「ターン間隔」を meta.unitTimeSec から整形して表として表示する", async () => {
    const { app } = setupTestApp({ unitTimeSec: 3600 });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("<th>ターン間隔</th>");
    expect(html).toContain("<td>1時間</td>");
  });

  it("開始前: 見出しは「ゲーム開始前」(「ターン 1」は出さない)、table.turn-info の1行目に「ゲーム開始」+残り時間、2行目に「ターン間隔」を表示し、「次のターン」は表示しない", async () => {
    const futureStart = INITIAL_CLOCK + 10_000;
    const { app } = setupTestApp({ startAt: futureStart, lastTime: futureStart });
    const res = await app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("<h2>ゲーム開始前</h2>");
    expect(html).not.toContain("ターン 1");
    expect(html).toContain('<table class="turn-info">');
    expect(html).toContain("<th>ゲーム開始</th>");
    // 10000秒 = 2時間46分 (0の単位は省略、「あと」の後に半角空白)。
    expect(html).toContain("(あと 2時間 46分)");
    expect(html).toContain("<th>ターン間隔</th>");
    expect(html).not.toContain("<th>次のターン</th>");
    expect(html).not.toContain("結果発表");
  });

  it("終了後 (現在のゲーム): 「結果発表 (ターンM終了時点)」を表示し、table.turn-info は出さない", async () => {
    const testApp = setupTestApp({ finalTurn: 1 });
    const meta = currentMeta(testApp);
    testApp.repo.saveMeta({ ...meta, turn: 2 });
    // tmp/18-games.md: 終了判定は status 列に昇格したため、明示的に finishGame を呼ぶ。
    testApp.repo.finishGame(currentGameId(testApp), meta.lastTime);

    const res = await testApp.app.request("/games/1");
    const html = await res.text();
    expect(html).toContain("結果発表");
    expect(html).toContain("ターン1終了時点");
    expect(html).not.toContain('<table class="turn-info">');
    // 現在のゲーム (isCurrent) が終了しただけなので、過去のゲーム向けの文言は出さない。
    expect(html).not.toContain("このゲームは終了しています。");
    // 終了後も既存の順位表 (諸島の状況) はそのまま表示する。
    expect(html).toContain("諸島の状況");
  });
});
