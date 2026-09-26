// web 層テスト用の共通セットアップ。*.test.tsx ではないので vitest には拾われない。
import { AdminPolicy } from "../app/admin-policy.ts";
import { AdminService } from "../app/admin-service.ts";
import { AuthMethodPolicy } from "../app/auth-methods.ts";
import type { AuthMethodsFlags } from "../app/auth-methods.ts";
import {
  FakeBackupStore,
  FakeClock,
  FakeGameRepository,
  FakeLogger,
  FakeSettingsRepository,
} from "../app/fake-repository.ts";
import { GameService } from "../app/game-service.ts";
import { defaultSiteSettings, SiteSettingsService } from "../app/site-settings.ts";
import type { SiteSettings } from "../app/site-settings.ts";
import { TurnService } from "../app/turn-service.ts";
import type { GameMeta } from "../app/ports.ts";
import { createCsrfToken } from "../bootstrap/csrf.ts";
import type { AppConfig } from "../bootstrap/config-from-env.ts";
import { defaultConfig } from "../core/config.ts";
import type { GameConfig } from "../core/config.ts";
import { createSeededRng } from "../core/rng.ts";
import { createApp } from "./app.tsx";
import type { WebDeps } from "./deps.ts";

export const INITIAL_CLOCK = 1_000_000;

export const SESSION_COOKIE_NAME = "hako.session_token";

export interface FakeSessionUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}

/** `deps.auth.api.listUserAccounts` が返す連携済みアカウントの最小モック。 */
export interface FakeLinkedAccount {
  id: string;
  providerId: string;
}

/**
 * tmp/14-users-auth.md「サーバーサイドでの呼び出し」節の `auth.api.getSession` の最小モック。
 * web 層のテストではログイン方法 (OAuth/magic-link/devLogin) 自体は better-auth 本体の責務なので
 * 検証しない (それは packages/node の実 DB 結合テストで行う)。ここでは
 * `getSession` がテストで用意したユーザーを返せれば十分。
 */
export class FakeAuth {
  #sessions = new Map<
    string,
    { user: FakeSessionUser; sessionId: string; accounts: FakeLinkedAccount[] }
  >();
  #counter = 0;

  api = {
    getSession: async ({ headers }: { headers: Headers }) => {
      const token = extractSessionToken(headers);
      if (token === undefined) {
        return null;
      }
      const entry = this.#sessions.get(token);
      if (entry === undefined) {
        return null;
      }
      const now = new Date();
      return {
        user: {
          ...entry.user,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: entry.sessionId,
          token,
          userId: entry.user.id,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          createdAt: now,
          updatedAt: now,
        },
      };
    },
    /**
     * `/account` (routes/account.tsx) 向けの最小モック。ログイン中セッションに紐づけた
     * `accounts` (login() の第 2 引数、または linkAccount()) をそのまま返す。
     */
    listUserAccounts: async ({ headers }: { headers: Headers }): Promise<FakeLinkedAccount[]> => {
      const token = extractSessionToken(headers);
      if (token === undefined) {
        return [];
      }
      return this.#sessions.get(token)?.accounts ?? [];
    },
  };

  /** `/api/auth/*` は web 層のテストでは叩かない想定 (実 better-auth を使う結合テストの領分)。 */
  handler = (): Promise<Response> => {
    throw new Error("FakeAuth.handler: not implemented (use packages/node の結合テスト)");
  };

  /** テストが「ログイン中」を模擬するための Cookie ヘッダ値と session.id を発行する。 */
  login(
    user: FakeSessionUser,
    accounts: FakeLinkedAccount[] = [],
  ): { cookieHeader: string; sessionId: string } {
    this.#counter += 1;
    const token = `test-token-${this.#counter}`;
    const sessionId = `test-session-${this.#counter}`;
    this.#sessions.set(token, { user, sessionId, accounts });
    return { cookieHeader: `${SESSION_COOKIE_NAME}=${token}`, sessionId };
  }
}

function extractSessionToken(headers: Headers): string | undefined {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      return rawValue.join("=");
    }
  }
  return undefined;
}

export interface SetupOptions {
  debug?: boolean;
  adminEnabled?: boolean;
  devLogin?: boolean;
  adminEmails?: string[];
  /**
   * サイト設定の初期値 (環境変数相当の `AppConfig.siteDefaults`)。省略した項目は
   * `defaultSiteSettings`。管理画面から保存した値は `testApp.siteSettings` で確認できる。
   */
  site?: Partial<SiteSettings>;
  gameOverrides?: Partial<GameConfig>;
  /** 初期化 (repo.initialize) をスキップする (not_initialized のテスト用)。 */
  skipInit?: boolean;
  /** tmp/16-season.md のテスト用。省略時は null (無期限)。 */
  finalTurn?: number | null;
  /** tmp/16-season.md のテスト用。省略時は INITIAL_CLOCK (開始済み)。 */
  startAt?: number;
  /** 省略時は INITIAL_CLOCK (turn=0 の meta.lastTime)。開始前状態のテストに使う。 */
  lastTime?: number;
  /** tmp/16-season.md「ターンの長さも DB に持つ」節のテスト用。省略時は config.unitTimeSec。 */
  unitTimeSec?: number;
  /**
   * ログイン方法の「設定済みか」(環境変数相当)。省略時は x/discord 無効・email 有効
   * (既存テストの挙動どおり)。X / Discord ログインボタンの表示を確認するテスト用に上書きできる。
   */
  authMethodsConfigured?: Partial<AuthMethodsFlags>;
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  repo: FakeGameRepository;
  clock: FakeClock;
  config: AppConfig;
  siteSettings: SiteSettingsService;
  gameService: GameService;
  turnService: TurnService;
  adminService: AdminService;
  adminPolicy: AdminPolicy;
  settings: FakeSettingsRepository;
  logger: FakeLogger;
  /** CSRF トークンの HMAC 鍵 (buildDeps の resolveAuthSecret 相当の解決済みの値)。 */
  authSecret: string;
  auth: FakeAuth;
}

export function setupTestApp(options: SetupOptions = {}): TestApp {
  const debug = options.debug ?? false;
  const game: GameConfig = { ...defaultConfig, debug, ...options.gameOverrides };

  const repo = new FakeGameRepository();
  if (options.skipInit !== true) {
    const startAt = options.startAt ?? INITIAL_CLOCK;
    const unitTimeSec = options.unitTimeSec ?? game.unitTimeSec;
    const gameId = repo.createGame(
      { name: "第 1 回", startAt, finalTurn: options.finalTurn ?? null, unitTimeSec },
      INITIAL_CLOCK,
    );
    const lastTime = options.lastTime ?? INITIAL_CLOCK;
    if (lastTime !== startAt) {
      repo.saveMeta({ ...repo.getMeta(gameId), lastTime });
    }
  }
  const clock = new FakeClock(INITIAL_CLOCK);
  const rng = createSeededRng(42);
  const backupStore = new FakeBackupStore();
  const logger = new FakeLogger();
  const auth = new FakeAuth();

  const config: AppConfig = {
    game,
    auth: {
      baseUrl: "http://localhost:5173",
      devLogin: options.devLogin ?? false,
      adminEmails: options.adminEmails ?? [],
    },
    mail: { mailFrom: "hakoniwa@example.com" },
    adminEnabled: options.adminEnabled ?? true,
    debug,
    siteDefaults: { ...defaultSiteSettings, ...options.site },
  };

  const siteSettings = new SiteSettingsService({
    settings: new FakeSettingsRepository(),
    fallback: config.siteDefaults,
  });
  const gameService = new GameService({ repo, clock, config: game, rng, siteSettings });

  const turnService = new TurnService({ repo, config: game, rng, backupStore, logger });
  const settings = new FakeSettingsRepository();
  const authMethods = new AuthMethodPolicy({
    configured: { x: false, discord: false, email: true, ...options.authMethodsConfigured },
    settings,
  });
  const adminPolicy = new AdminPolicy({ envEmails: config.auth.adminEmails, settings });
  const authSecret = "test-secret";
  const adminService = new AdminService({
    repo,
    clock,
    config: game,
    backupStore,
    turnService,
    authMethods,
    mailerIsConsole: true,
  });

  const deps: WebDeps = {
    gameService,
    turnService,
    adminService,
    adminPolicy,
    config,
    authSecret,
    siteSettings,
    clock,
    auth: auth as unknown as WebDeps["auth"],
    logger,
  };
  const app = createApp(deps);

  return {
    app,
    repo,
    clock,
    config,
    gameService,
    turnService,
    adminService,
    adminPolicy,
    settings,
    logger,
    authSecret,
    siteSettings,
    auth,
  };
}

/** 現在のゲーム ID。tmp/18-games.md 対応でテストの repo アクセスに gameId が要る箇所用。 */
export function currentGameId(testApp: TestApp): number {
  const gameId = testApp.repo.getCurrentGameId();
  if (gameId === undefined) {
    throw new Error("currentGameId: no current game");
  }
  return gameId;
}

/** 現在のゲームの `GameMeta`。 */
export function currentMeta(testApp: TestApp): GameMeta {
  return testApp.repo.getMeta(currentGameId(testApp));
}

/**
 * `testApp.auth.login(user)` でセッションを作り、そのまま POST に使える Cookie ヘッダと
 * `_csrf` トークンをまとめて返す。`accounts` は `/account` (GET) が返す連携済みアカウント一覧
 * (`deps.auth.api.listUserAccounts`) のモック用。省略時は連携済みなし。
 */
export async function loginAs(
  testApp: TestApp,
  user: FakeSessionUser,
  accounts: FakeLinkedAccount[] = [],
): Promise<{ cookie: string; csrfToken: string; user: FakeSessionUser }> {
  const { cookieHeader, sessionId } = testApp.auth.login(user, accounts);
  const csrfToken = await createCsrfToken(testApp.authSecret, sessionId);
  return { cookie: cookieHeader, csrfToken, user };
}

/** `application/x-www-form-urlencoded` の body を組み立てる小さなヘルパ。 */
export function formBody(fields: Record<string, string | number>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, String(value));
  }
  return params;
}

export async function postForm(
  app: ReturnType<typeof createApp>,
  path: string,
  fields: Record<string, string | number>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    body: formBody(fields),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
}
