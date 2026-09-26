import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth.ts";
import { defaultConfig } from "../core/config.ts";
import { CommandKind, LandKind } from "../core/constants.ts";
import { createSeededRng } from "../core/rng.ts";
import { createTerrain } from "../core/terrain.ts";
import { AppError } from "./errors.ts";
import { FakeClock, FakeGameRepository, FakeSettingsRepository } from "./fake-repository.ts";
import type { GameServiceDeps } from "./game-service.ts";
import { GameService } from "./game-service.ts";
import { defaultSiteSettings, SiteSettingsService } from "./site-settings.ts";
import type { SiteSettings } from "./site-settings.ts";

function user(id: string, name = `user-${id}`): AuthUser {
  return { id, name, email: `${id}@example.com`, isAdmin: false };
}

/**
 * `repo.createGame` でゲームを作り (既にゲームがあれば流用)、gameId も返す
 * (旧 `repo.initialize({...})` の代わり)。`skipInit` のときはゲームを作らず、
 * `gameId` はダミー値 (1) を返す (not_initialized のテストで使う)。
 */
/** `setup` の上書き。`site` はサイト設定 (追加 NG ワード・ローカル掲示板等) の一部を上書きする。 */
type SetupOverrides = Partial<GameServiceDeps> & { site?: Partial<SiteSettings> };

function setup(overrides: SetupOverrides = {}, options: { skipInit?: boolean } = {}) {
  const repo = overrides.repo ?? new FakeGameRepository();
  let gameId = repo.getCurrentGameId();
  if (!options.skipInit && gameId === undefined) {
    gameId = repo.createGame(
      { name: "第 1 回", startAt: 0, finalTurn: null, unitTimeSec: defaultConfig.unitTimeSec },
      0,
    );
  }
  const { site, ...rest } = overrides;
  const siteSettings = new SiteSettingsService({
    settings: new FakeSettingsRepository(),
    fallback: { ...defaultSiteSettings, ...site },
  });
  const deps: GameServiceDeps = {
    repo,
    clock: new FakeClock(1_000_000),
    config: defaultConfig,
    rng: createSeededRng(42),
    siteSettings,
    ...rest,
  };
  return { repo, deps, siteSettings, service: new GameService(deps), gameId: gameId ?? 1 };
}

function expectAppError(fn: () => unknown, kind: string): void {
  try {
    fn();
    expect.fail(`expected AppError(${kind}) but nothing was thrown`);
  } catch (err) {
    expect(err instanceof AppError && err.kind).toBe(kind);
  }
}

describe("GameService.createIsland", () => {
  it("正常に作成でき、NewIslandVM を返し、発見が history に記録される", () => {
    const { service, repo, gameId } = setup();
    const vm = service.createIsland(user("u1"), gameId, "テスト島");
    expect(vm.name).toBe("テスト島");
    expect(vm.rank).toBe(1);
    expect(vm.money).toBe(defaultConfig.initialMoney);

    const history = repo.listHistory(gameId, 10);
    expect(history).toHaveLength(1);
    expect(history[0]?.html).toContain("テスト島");
  });

  it("login_required: 未ログインでは作成できない", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.createIsland(undefined, gameId, "テスト島"), "login_required");
  });

  it("already_has_island: 既に自分の島を持っていると作成できない", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "島1");
    expectAppError(() => service.createIsland(user("u1"), gameId, "島2"), "already_has_island");
  });

  it("island_full: 上限に達していると作成できない", () => {
    const { service, gameId } = setup({ config: { ...defaultConfig, maxIslands: 0 } });
    expectAppError(() => service.createIsland(user("u1"), gameId, "テスト島"), "island_full");
  });

  it("no_name: 名前が空", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.createIsland(user("u1"), gameId, ""), "no_name");
  });

  it("bad_name: 禁止文字を含む", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.createIsland(user("u1"), gameId, "island?1"), "bad_name");
  });

  it("bad_name: 「無人」という名前", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.createIsland(user("u1"), gameId, "無人"), "bad_name");
  });

  it("ng_word: NG ワードを含む名前", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.createIsland(user("u1"), gameId, "エロティズム島"), "ng_word");
  });

  it("サイト設定の変更 (追加 NG ワード) は次の呼び出しから反映される", () => {
    const { service, gameId, siteSettings } = setup();
    const created = service.createIsland(user("u1"), gameId, "あとからだめ");
    expect(created.name).toBe("あとからだめ");
    siteSettings.update({ ...defaultSiteSettings, ngWords: ["だめ"] });
    expectAppError(() => service.createIsland(user("u2"), gameId, "もっとだめ"), "ng_word");
  });

  it("サイト設定の追加 NG ワードも検出する", () => {
    const { service, gameId } = setup({ site: { ngWords: ["きんしご"] } });
    expectAppError(() => service.createIsland(user("u1"), gameId, "きんしご島"), "ng_word");
  });

  it("name_taken: 既に存在する名前", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(() => service.createIsland(user("u2"), gameId, "テスト島"), "name_taken");
  });

  it("2番目以降の島は末尾の順位になる", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "島1");
    const vm2 = service.createIsland(user("u2"), gameId, "島2");
    expect(vm2.rank).toBe(2);
  });

  it("game_not_found: 存在しない gameId", () => {
    const { service, gameId } = setup();
    expectAppError(
      () => service.createIsland(user("u1"), gameId + 999, "テスト島"),
      "game_not_found",
    );
  });
});

describe("GameService.openOwnerPage", () => {
  it("自分の島の OwnerPageVM を返す", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    const vm = service.openOwnerPage(user("u1"), gameId);
    expect(vm.name).toBe("テスト島");
    expect(vm.money).toBe(defaultConfig.initialMoney);
    expect(vm.commands).toHaveLength(defaultConfig.commandMax);
    expect(vm.defaults).toEqual({});
    expect(vm.game).toEqual({ id: gameId, name: "第 1 回", status: "running", isCurrent: true });
  });

  it("login_required: 未ログイン", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.openOwnerPage(undefined, gameId), "login_required");
  });

  it("no_island: 自分の島を持っていない", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.openOwnerPage(user("u1"), gameId), "no_island");
  });
});

describe("GameService.registerCommand", () => {
  function setupIsland() {
    const s = setup();
    s.service.createIsland(user("u1"), s.gameId, "テスト島");
    return s;
  }

  it("write モード: 指定位置に書き込み、user_prefs が更新される", () => {
    const { service, repo, gameId } = setupIsland();
    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 1,
      y: 1,
      amount: 0,
      target: 0,
      mode: "write",
    });
    expect(result.commands[0]?.text).toContain("整地");
    expect(result.notice).toBeTruthy();
    expect(repo.getUserPrefs("u1")).toEqual({
      targetIslandId: 0,
      pointX: 1,
      pointY: 1,
      kind: CommandKind.Prepare,
    });
    expect(result.defaults).toEqual({
      targetIslandId: 0,
      pointX: 1,
      pointY: 1,
      kind: CommandKind.Prepare,
    });
  });

  it("insert モード: 既存を後ろへずらして挿入する", () => {
    const { service, gameId } = setupIsland();
    service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 1,
      y: 1,
      amount: 0,
      target: 0,
      mode: "write",
    });
    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Reclaim,
      x: 2,
      y: 2,
      amount: 0,
      target: 0,
      mode: "insert",
    });
    expect(result.commands[0]?.text).toContain("埋め立て");
    expect(result.commands[1]?.text).toContain("整地");
  });

  it("delete モード: 指定位置を削除し、末尾に資金繰りを補充する", () => {
    const { service, gameId } = setupIsland();
    service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 1,
      y: 1,
      amount: 0,
      target: 0,
      mode: "write",
    });
    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.DoNothing,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "delete",
    });
    expect(result.commands[0]?.text).toBe("資金繰り");
    expect(result.commands[defaultConfig.commandMax - 1]?.text).toBe("資金繰り");
  });

  it("AutoPrepare: 荒地を自動で整地予定 (kind: Prepare) に入れる", () => {
    const { service, repo, gameId } = setupIsland();
    const summary = repo.findIslandByOwner(gameId, "u1");
    if (summary === undefined) throw new Error("island not found");
    const island = repo.findIsland(gameId, summary.id);
    if (island === undefined) throw new Error("island not found");
    island.terrain = createTerrain(defaultConfig.islandSize);
    island.terrain.setKind(0, 0, LandKind.Waste, 0);
    island.terrain.setKind(1, 1, LandKind.Waste, 0);
    repo.updateIsland(gameId, island);

    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.AutoPrepare,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });

    // 保存された計画の kind は AutoPrepare(61) のままではなく、実行可能な Prepare(1) であること
    // (61/62 のまま保存されると turn/command.ts の switch に該当 case が無く、何も実行されず
    // 1 ターン 1 枠を消費するだけになるバグの再発防止)。
    const updated = repo.findIsland(gameId, summary.id);
    if (updated === undefined) throw new Error("island not found");
    const registered = updated.commands.filter((c) => c.kind !== CommandKind.DoNothing);
    expect(registered).toHaveLength(2);
    expect(registered.every((c) => c.kind === CommandKind.Prepare)).toBe(true);

    // 表示文言も「整地自動入力」ではなく「整地」であること。
    const texts = result.commands.map((c) => c.text);
    expect(texts.filter((t) => t.endsWith("で整地"))).toHaveLength(2);
    expect(texts.some((t) => t.includes("整地自動入力"))).toBe(false);
  });

  it("AutoPrepare2: 荒地を自動で地ならし予定 (kind: Prepare2) に入れる", () => {
    const { service, repo, gameId } = setupIsland();
    const summary = repo.findIslandByOwner(gameId, "u1");
    if (summary === undefined) throw new Error("island not found");
    const island = repo.findIsland(gameId, summary.id);
    if (island === undefined) throw new Error("island not found");
    island.terrain = createTerrain(defaultConfig.islandSize);
    island.terrain.setKind(0, 0, LandKind.Waste, 0);
    island.terrain.setKind(1, 1, LandKind.Waste, 0);
    repo.updateIsland(gameId, island);

    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.AutoPrepare2,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });

    const updated = repo.findIsland(gameId, summary.id);
    if (updated === undefined) throw new Error("island not found");
    const registered = updated.commands.filter((c) => c.kind !== CommandKind.DoNothing);
    expect(registered).toHaveLength(2);
    expect(registered.every((c) => c.kind === CommandKind.Prepare2)).toBe(true);

    const texts = result.commands.map((c) => c.text);
    expect(texts.filter((t) => t.endsWith("で地ならし"))).toHaveLength(2);
    expect(texts.some((t) => t.includes("地ならし自動入力"))).toBe(false);
  });

  it("AutoDelete: 全て資金繰りにする", () => {
    const { service, gameId } = setupIsland();
    service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 1,
      y: 1,
      amount: 0,
      target: 0,
      mode: "write",
    });
    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.AutoDelete,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });
    expect(result.commands.every((c) => c.text === "資金繰り")).toBe(true);
  });

  it("forbidden: 他人の島には登録できない", () => {
    const { service, gameId } = setupIsland();
    expectAppError(
      () =>
        service.registerCommand(user("u2"), gameId, {
          number: 0,
          kind: CommandKind.Prepare,
          x: 0,
          y: 0,
          amount: 0,
          target: 0,
          mode: "write",
        }),
      "no_island",
    );
  });

  it.each([
    { field: "number", value: { number: -1 } },
    { field: "number", value: { number: defaultConfig.commandMax } },
    { field: "x", value: { x: -1 } },
    { field: "x", value: { x: defaultConfig.islandSize } },
    { field: "y", value: { y: -1 } },
    { field: "amount", value: { amount: -1 } },
    { field: "amount", value: { amount: 100 } },
    { field: "kind", value: { kind: 9999 } },
  ])("範囲外の入力 ($field) は invalid_input", ({ value }) => {
    const { service, gameId } = setupIsland();
    expectAppError(
      () =>
        service.registerCommand(user("u1"), gameId, {
          number: 0,
          kind: CommandKind.Prepare,
          x: 0,
          y: 0,
          amount: 0,
          target: 0,
          mode: "write",
          ...value,
        }),
      "invalid_input",
    );
  });
});

describe("GameService.updateComment", () => {
  it("コメントを更新できる", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.updateComment(user("u1"), gameId, "よろしく");
    expect(result.comment).toBe("よろしく");
  });

  it("ng_word: NG ワードを含むコメント", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(() => service.updateComment(user("u1"), gameId, "エロティズム"), "ng_word");
  });

  it("no_island: 自分の島を持っていない", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.updateComment(user("u1"), gameId, "よろしく"), "no_island");
  });
});

describe("GameService.changeName", () => {
  it("資金が十分なら成功し、コストが引かれる", () => {
    const { service, repo, gameId } = setup({ config: { ...defaultConfig, costChangeName: 10 } });
    service.createIsland(user("u1"), gameId, "元の名前");
    service.changeName(user("u1"), gameId, "新しい名前");

    const summary = repo.findIslandByOwner(gameId, "u1");
    const island = summary && repo.findIsland(gameId, summary.id);
    expect(island?.name).toBe("新しい名前");
    expect(island?.money).toBe(defaultConfig.initialMoney - 10);
  });

  it("資金が不足していると no_money", () => {
    const { service, repo, gameId } = setup();
    service.createIsland(user("u1"), gameId, "元の名前");
    const summary = repo.findIslandByOwner(gameId, "u1");
    if (summary === undefined) throw new Error("island not found");
    const island = repo.findIsland(gameId, summary.id);
    if (island === undefined) throw new Error("island not found");
    island.money = 0;
    repo.updateIsland(gameId, island);

    expectAppError(() => service.changeName(user("u1"), gameId, "新しい名前"), "no_money");
  });

  it("ng_word: NG ワードを含む新しい名前", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "元の名前");
    expectAppError(() => service.changeName(user("u1"), gameId, "エロティズム"), "ng_word");
  });

  it("no_island: 自分の島を持っていない", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.changeName(user("u1"), gameId, "新しい名前"), "no_island");
  });
});

describe("GameService.postLbbs", () => {
  function setupWithLbbs() {
    return setup({ site: { useLbbs: true } });
  }

  it("自分の島には owner として記帳できる", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.postLbbs(user("u1", "島主"), gameId, created.id, "ようこそ");
    expect(result.lbbs[0]).toMatchObject({ author: "owner", name: "島主", message: "ようこそ" });
  });

  it("他人の島には visitor として記帳できる", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.postLbbs(user("u2", "旅人"), gameId, created.id, "こんにちは");
    expect(result.lbbs[0]).toMatchObject({
      author: "visitor",
      name: "旅人",
      message: "こんにちは",
    });
  });

  it("login_required: 未ログインでは記帳できない", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(
      () => service.postLbbs(undefined, gameId, created.id, "こんにちは"),
      "login_required",
    );
  });

  it("useLbbs が false なら lbbs_disabled", () => {
    const { service, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(
      () => service.postLbbs(user("u2"), gameId, created.id, "こんにちは"),
      "lbbs_disabled",
    );
  });

  it("メッセージが空なら lbbs_empty", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(() => service.postLbbs(user("u2"), gameId, created.id, ""), "lbbs_empty");
  });

  it("ng_word: NG ワードを含むメッセージ", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    expectAppError(
      () => service.postLbbs(user("u2"), gameId, created.id, "エロティズム"),
      "ng_word",
    );
  });

  it("lbbsMax を超えた分は切り詰められる", () => {
    const { service, gameId } = setup({
      config: { ...defaultConfig, lbbsMax: 2 },
      site: { useLbbs: true },
    });
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    service.postLbbs(user("u2", "旅人1"), gameId, created.id, "1件目");
    service.postLbbs(user("u3", "旅人2"), gameId, created.id, "2件目");
    const result = service.postLbbs(user("u4", "旅人3"), gameId, created.id, "3件目");
    expect(result.lbbs).toHaveLength(2);
    expect(result.lbbs[0]?.name).toBe("旅人3");
  });

  it("tmp/18-games.md: 過去の (現在でない) ゲームには記帳できない", () => {
    const { service, repo, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    repo.finishGame(gameId, 2_000_000);
    repo.createGame(
      {
        name: "第 2 回",
        startAt: 2_000_000,
        finalTurn: null,
        unitTimeSec: defaultConfig.unitTimeSec,
      },
      2_000_000,
    );
    expectAppError(
      () => service.postLbbs(user("u2"), gameId, created.id, "こんにちは"),
      "game_finished",
    );
  });
});

describe("GameService.deleteLbbs", () => {
  function setupWithLbbs() {
    return setup({ site: { useLbbs: true } });
  }

  it("自分の島の記帳を削除できる", () => {
    const { service, gameId } = setupWithLbbs();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    service.postLbbs(user("u2", "旅人1"), gameId, created.id, "1件目");
    service.postLbbs(user("u3", "旅人2"), gameId, created.id, "2件目");
    const result = service.deleteLbbs(user("u1"), gameId, 0);
    expect(result.lbbs[0]).toMatchObject({ name: "旅人1" });
  });

  it("no_island: 自分の島を持っていない", () => {
    const { service, gameId } = setupWithLbbs();
    expectAppError(() => service.deleteLbbs(user("u1"), gameId, 0), "no_island");
  });
});

describe("GameService.getTopPage / getIslandPage", () => {
  it("not_initialized: 初期化前は例外", () => {
    const repo = new FakeGameRepository();
    const { service, gameId } = setup({ repo }, { skipInit: true });
    expectAppError(() => service.getTopPage(undefined, gameId), "not_initialized");
  });

  it("島を作ると canCreate や順位が反映される", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "島1");
    const top = service.getTopPage(undefined, gameId);
    expect(top.islands).toHaveLength(1);
    expect(top.islands[0]?.rank).toBe(1);
    expect(top.canCreate).toBe(true);
    expect(top.viewer).toEqual({ hasIsland: false });
    expect(top.game).toEqual({ id: gameId, name: "第 1 回", status: "running", isCurrent: true });
  });

  it("viewer は actor とその島の有無を反映する", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "島1");
    const top = service.getTopPage(user("u1"), gameId);
    expect(top.viewer.user?.id).toBe("u1");
    expect(top.viewer.hasIsland).toBe(true);

    const topOther = service.getTopPage(user("u2"), gameId);
    expect(topOther.viewer.hasIsland).toBe(false);
  });

  it("観光画面は moneyDisplay を持つ", () => {
    const { service, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "島1");
    const page = service.getIslandPage(gameId, created.id);
    expect(page.moneyDisplay.mode).toBe("about");
  });

  it("存在しない島は island_not_found", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.getIslandPage(gameId, 999), "island_not_found");
  });

  it("game_not_found: 存在しない gameId", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.getIslandPage(gameId + 999, 1), "game_not_found");
  });

  it("tmp/16-season.md: getTopPage/getIslandPage は season を含む", () => {
    const { service, repo, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "島1");
    // tmp/16-season.md「開始前の状態 = ターン 0」節: TurnService を通していないので turn=0 (開始前)
    // のまま。ターン処理済みの `running` 状態を確かめるため、1 ターン進んだことにする。
    repo.saveMeta({ ...repo.getMeta(gameId), turn: 1 });
    const top = service.getTopPage(undefined, gameId);
    expect(top.season).toMatchObject({ turn: 1, finalTurn: null, state: "running" });
    const owner = service.openOwnerPage(user("u1"), gameId);
    expect(owner.season).toMatchObject({ turn: 1, finalTurn: null, state: "running" });
    void created;
  });

  it("tmp/17-ogp.md: getIslandPage の ogp は島名・ターン・人口・面積・順位を含む", () => {
    const { service, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "しま");
    const page = service.getIslandPage(gameId, created.id);
    expect(page.ogp.description).toBe(
      `ターン${page.turn} / 人口 ${page.pop}${defaultConfig.units.pop}・` +
        `面積 ${page.area}${defaultConfig.units.area}・順位 ${page.rank}位`,
    );
    // tmp/18-games.md: OGP の imagePath はゲーム ID 入りの URL になった。
    expect(page.ogp.imagePath).toBe(
      `/games/${gameId}/islands/${created.id}/ogp.png?turn=${page.turn}`,
    );
    expect(page.ogp.width).toBe(800);
    expect(page.ogp.height).toBe(420);
  });
});

describe("GameService.getIslandOgp", () => {
  it("island と現在ターンを返す", () => {
    const { service, repo, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "しま");
    const { island, turn } = service.getIslandOgp(gameId, created.id);
    expect(island.id).toBe(created.id);
    expect(turn).toBe(repo.getMeta(gameId).turn);
  });

  it("存在しない島は island_not_found", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.getIslandOgp(gameId, 999), "island_not_found");
  });

  it("not_initialized: 初期化前は例外", () => {
    const repo = new FakeGameRepository();
    const { service, gameId } = setup({ repo }, { skipInit: true });
    expectAppError(() => service.getIslandOgp(gameId, 1), "not_initialized");
  });
});

describe("GameService 終了後 (game_finished)", () => {
  /** 島を1つ作ってから、repo 上で強制的にゲームを終了状態にする (finalTurn=1 に設定して finishGame)。 */
  function setupFinished() {
    const s = setup({ site: { useLbbs: true } });
    const created = s.service.createIsland(user("u1"), s.gameId, "テスト島");
    // tmp/16-season.md「開始前の状態 = ターン 0」節: 最終ターン (1) まで実際に処理が
    // 進んだ状態にしてから終了させる (turn=1, firstTurn=0 → 実行済み回数 1)。
    s.repo.saveMeta({ ...s.repo.getMeta(s.gameId), turn: 1, finalTurn: 1 });
    s.repo.finishGame(s.gameId, 2_000_000);
    return { ...s, islandId: created.id };
  }

  it("createIsland は game_finished", () => {
    const { service, gameId } = setupFinished();
    expectAppError(() => service.createIsland(user("u2"), gameId, "新しい島"), "game_finished");
  });

  it("registerCommand は game_finished", () => {
    const { service, gameId } = setupFinished();
    expectAppError(
      () =>
        service.registerCommand(user("u1"), gameId, {
          number: 0,
          kind: CommandKind.Prepare,
          x: 0,
          y: 0,
          amount: 0,
          target: 0,
          mode: "write",
        }),
      "game_finished",
    );
  });

  it("updateComment は game_finished", () => {
    const { service, gameId } = setupFinished();
    expectAppError(() => service.updateComment(user("u1"), gameId, "こんにちは"), "game_finished");
  });

  it("changeName は game_finished", () => {
    const { service, gameId } = setupFinished();
    expectAppError(() => service.changeName(user("u1"), gameId, "新しい名前"), "game_finished");
  });

  it("postLbbs は終了後も (現在のゲームであれば) 許可される", () => {
    const { service, gameId, islandId } = setupFinished();
    const result = service.postLbbs(user("u2", "旅人"), gameId, islandId, "感想です");
    expect(result.lbbs[0]).toMatchObject({ name: "旅人", message: "感想です" });
  });

  it("getTopPage / getIslandPage / openOwnerPage は終了後も閲覧できる (season.state === 'finished')", () => {
    const { service, gameId, islandId } = setupFinished();
    const top = service.getTopPage(undefined, gameId);
    expect(top.season.state).toBe("finished");
    expect(top.season.finishedAtTurn).toBe(1);
    expect(top.canCreate).toBe(false);
    const island = service.getIslandPage(gameId, islandId);
    expect(island.name).toBe("テスト島");
    const owner = service.openOwnerPage(user("u1"), gameId);
    expect(owner.season.state).toBe("finished");
  });
});

// tmp/19-abandon.md (島の放棄と新しい島の発見)。
describe("GameService.abandonIsland", () => {
  it("町を荒地にして pop を 0 にし、計画を資金繰りに戻し、abandoned_at を記録する", () => {
    const { service, repo, gameId } = setup();
    const created = service.createIsland(user("u1"), gameId, "テスト");
    // コマンドを1件登録しておき、放棄後に資金繰りへ戻ることを確認する。
    service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });

    const result = service.abandonIsland(user("u1"), gameId);
    expect(result.notice).toBe(`テスト島を放棄しました。残り2回放棄できます。`);

    const island = repo.findIsland(gameId, created.id);
    expect(island?.abandonedAt).not.toBeNull();
    expect(island?.pop).toBe(0);
    expect(island?.commands.every((c) => c.kind === CommandKind.DoNothing)).toBe(true);
    for (let y = 0; y < (island?.terrain.size ?? 0); y++) {
      for (let x = 0; x < (island?.terrain.size ?? 0); x++) {
        expect(island?.terrain.get(x, y).kind).not.toBe(LandKind.Town);
      }
    }
  });

  it("放棄後は findIslandByOwner が undefined を返し、直ちに新しい島を作れる", () => {
    const { service, repo, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    service.abandonIsland(user("u1"), gameId);
    expect(repo.findIslandByOwner(gameId, "u1")).toBeUndefined();

    const created = service.createIsland(user("u1"), gameId, "新しい島");
    expect(created.name).toBe("新しい島");
  });

  it("history に「放棄され無人島となる」を追記する", () => {
    const { service, repo, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    service.abandonIsland(user("u1"), gameId);
    const history = repo.listHistory(gameId, 10);
    expect(history[0]?.html).toContain("テスト島");
    expect(history[0]?.html).toContain("放棄され");
  });

  it("4 回目の放棄は abandon_limit (409)", () => {
    const { service, repo, gameId } = setup();
    for (let i = 0; i < 3; i++) {
      service.createIsland(user("u1"), gameId, `島${i}`);
      service.abandonIsland(user("u1"), gameId);
    }
    service.createIsland(user("u1"), gameId, "4島目");
    expectAppError(() => service.abandonIsland(user("u1"), gameId), "abandon_limit");
    expect(repo.countAbandonments(gameId, "u1")).toBe(3);
  });

  it("残り放棄可能回数は OwnerPageVM.abandon.remaining に表れる", () => {
    const { service, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    let owner = service.openOwnerPage(user("u1"), gameId);
    expect(owner.abandon.remaining).toBe(3);

    service.abandonIsland(user("u1"), gameId);
    service.createIsland(user("u1"), gameId, "2代目");
    owner = service.openOwnerPage(user("u1"), gameId);
    expect(owner.abandon.remaining).toBe(2);
  });

  it("島を持っていなければ no_island", () => {
    const { service, gameId } = setup();
    expectAppError(() => service.abandonIsland(user("u1"), gameId), "no_island");
  });

  it("終了後は game_finished", () => {
    const { service, repo, gameId } = setup();
    service.createIsland(user("u1"), gameId, "テスト島");
    repo.saveMeta({ ...repo.getMeta(gameId), finalTurn: 1 });
    repo.finishGame(gameId, 2_000_000);
    expectAppError(() => service.abandonIsland(user("u1"), gameId), "game_finished");
  });

  it("開始前でも許可される", () => {
    const repo = new FakeGameRepository();
    repo.createGame(
      {
        name: "第 1 回",
        startAt: 2_000_000,
        finalTurn: null,
        unitTimeSec: defaultConfig.unitTimeSec,
      },
      0,
    );
    const { service, gameId } = setup({ repo, clock: new FakeClock(1_000_000) });
    service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.abandonIsland(user("u1"), gameId);
    expect(result.notice).toContain("放棄しました");
  });
});

// tmp/16-season.md「開始前の状態 (追加要件)」節。コーディネーターの追加指示により、
// 計画登録も開始前に許可する (開始前に登録した計画はターン1終了時に実行される)。
describe("GameService 開始前", () => {
  /** startAt を clock.now() より未来にして「開始前」状態を作る。 */
  function setupBeforeStart() {
    const repo = new FakeGameRepository();
    repo.createGame(
      {
        name: "第 1 回",
        startAt: 2_000_000,
        finalTurn: null,
        unitTimeSec: defaultConfig.unitTimeSec,
      },
      0,
    );
    return setup({
      repo,
      clock: new FakeClock(1_000_000),
      config: { ...defaultConfig, costChangeName: 10 },
      site: { useLbbs: true },
    });
  }

  it("season.state は 'before'", () => {
    const { service, gameId } = setupBeforeStart();
    const top = service.getTopPage(undefined, gameId);
    expect(top.season.state).toBe("before");
  });

  it("createIsland は開始前でも許可される", () => {
    const { service, gameId } = setupBeforeStart();
    const vm = service.createIsland(user("u1"), gameId, "テスト島");
    expect(vm.name).toBe("テスト島");
  });

  it("registerCommand は開始前でも許可される", () => {
    const { service, gameId } = setupBeforeStart();
    service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.registerCommand(user("u1"), gameId, {
      number: 0,
      kind: CommandKind.Prepare,
      x: 0,
      y: 0,
      amount: 0,
      target: 0,
      mode: "write",
    });
    expect(result.notice).toBe("コマンドを登録しました。");
  });

  it("updateComment は開始前でも許可される", () => {
    const { service, gameId } = setupBeforeStart();
    service.createIsland(user("u1"), gameId, "テスト島");
    const result = service.updateComment(user("u1"), gameId, "よろしく");
    expect(result.comment).toBe("よろしく");
  });

  it("changeName は開始前でも許可される", () => {
    const { service, gameId } = setupBeforeStart();
    service.createIsland(user("u1"), gameId, "元の名前");
    const result = service.changeName(user("u1"), gameId, "新しい名前");
    expect(result.name).toBe("新しい名前");
  });

  it("postLbbs / deleteLbbs は開始前でも許可される", () => {
    const { service, gameId } = setupBeforeStart();
    const created = service.createIsland(user("u1"), gameId, "テスト島");
    const posted = service.postLbbs(user("u2", "旅人"), gameId, created.id, "こんにちは");
    expect(posted.lbbs[0]).toMatchObject({ name: "旅人", message: "こんにちは" });
    const deleted = service.deleteLbbs(user("u1"), gameId, 0);
    expect(deleted.lbbs).toHaveLength(0);
  });
});

// tmp/18-games.md「複数ゲーム (過去のゲームの保存)」節。
describe("GameService: 複数ゲーム", () => {
  function setupTwoGames() {
    const s = setup({ site: { useLbbs: true } });
    const oldGameId = s.gameId;
    const created = s.service.createIsland(user("u1"), oldGameId, "旧島");
    s.repo.finishGame(oldGameId, 2_000_000);
    const newGameId = s.repo.createGame(
      {
        name: "第 2 回",
        startAt: 2_000_000,
        finalTurn: null,
        unitTimeSec: defaultConfig.unitTimeSec,
      },
      2_000_000,
    );
    return { ...s, oldGameId, newGameId, oldIslandId: created.id };
  }

  it("過去のゲームへの createIsland/registerCommand/updateComment/changeName は game_finished", () => {
    const { service, oldGameId } = setupTwoGames();
    expectAppError(() => service.createIsland(user("u2"), oldGameId, "新しい島"), "game_finished");
    expectAppError(
      () => service.updateComment(user("u1"), oldGameId, "こんにちは"),
      "game_finished",
    );
    expectAppError(() => service.changeName(user("u1"), oldGameId, "新しい名前"), "game_finished");
    expectAppError(
      () =>
        service.registerCommand(user("u1"), oldGameId, {
          number: 0,
          kind: CommandKind.Prepare,
          x: 0,
          y: 0,
          amount: 0,
          target: 0,
          mode: "write",
        }),
      "game_finished",
    );
  });

  it("過去のゲームへの postLbbs/deleteLbbs は game_finished (現在のゲームでないため)", () => {
    const { service, oldGameId, oldIslandId } = setupTwoGames();
    expectAppError(
      () => service.postLbbs(user("u2"), oldGameId, oldIslandId, "こんにちは"),
      "game_finished",
    );
    expectAppError(() => service.deleteLbbs(user("u1"), oldGameId, 0), "game_finished");
  });

  it("過去のゲームでも getTopPage/getIslandPage/openOwnerPage で閲覧はできる", () => {
    const { service, oldGameId, oldIslandId } = setupTwoGames();
    const top = service.getTopPage(undefined, oldGameId);
    expect(top.game.isCurrent).toBe(false);
    expect(top.game.status).toBe("finished");
    const page = service.getIslandPage(oldGameId, oldIslandId);
    expect(page.game.isCurrent).toBe(false);
    const owner = service.openOwnerPage(user("u1"), oldGameId);
    expect(owner.game.isCurrent).toBe(false);
  });

  it("ユーザーは新しいゲームで再度島を作れる (1 ユーザー 1 島はゲームごと)", () => {
    const { service, newGameId } = setupTwoGames();
    // u1 は旧ゲームで既に島を持っているが、新しいゲームでは持っていない。
    const vm = service.createIsland(user("u1"), newGameId, "新しい島");
    expect(vm.name).toBe("新しい島");
    const owner = service.openOwnerPage(user("u1"), newGameId);
    expect(owner.name).toBe("新しい島");
  });

  it("listGames は新しい順に isCurrent 付きで返す", () => {
    const { service, oldGameId, newGameId } = setupTwoGames();
    const games = service.listGames();
    expect(games.map((g) => g.id)).toEqual([newGameId, oldGameId]);
    expect(games.find((g) => g.id === newGameId)?.isCurrent).toBe(true);
    expect(games.find((g) => g.id === oldGameId)?.isCurrent).toBe(false);
  });

  it("getCurrentGameId は最新のゲーム ID を返す", () => {
    const { service, newGameId } = setupTwoGames();
    expect(service.getCurrentGameId()).toBe(newGameId);
  });
});
