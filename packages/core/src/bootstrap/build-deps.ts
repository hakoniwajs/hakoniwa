// tmp/13-monorepo.md 「@hakoniwajs/core の公開 API」、tmp/08 の buildDeps、
// tmp/14-users-auth.md 「bootstrap」節に対応する組立関数。
import { AdminPolicy } from "../app/admin-policy.ts";
import { AdminService } from "../app/admin-service.ts";
import { AuthMethodPolicy } from "../app/auth-methods.ts";
import type { AuthMethodsFlags } from "../app/auth-methods.ts";
import { GameService } from "../app/game-service.ts";
import type { BackupStore, Clock, Logger, Mailer } from "../app/ports.ts";
import { TurnService } from "../app/turn-service.ts";
import { createMathRandomRng } from "../core/rng.ts";
import type { Rng } from "../core/rng.ts";
import type { SqlDriver } from "../storage/driver.ts";
import { SqliteGameRepository } from "../storage/repository.ts";
import { SqliteSettingsRepository } from "../storage/settings-repository.ts";
import { createApp } from "../web/app.tsx";
import type { WebDeps } from "../web/deps.ts";
import { createAuth } from "./auth.ts";
import { resolveAuthSecret } from "./auth-secret.ts";
import type { AppConfig } from "./config-from-env.ts";
import { ConsoleMailer, ResendMailer } from "./mailer.ts";

export interface BuildDepsInput {
  driver: SqlDriver;
  backupStore: BackupStore;
  clock: Clock;
  config: AppConfig;
  /** 省略時は `createMathRandomRng()`。 */
  rng?: Rng;
  /** 省略時は console ベースの実装 (bootstrap 内でのみ console の使用を許容する)。 */
  logger?: Logger;
  /** テスト用に注入可能。省略時は `config.mail` から `ConsoleMailer`/`ResendMailer` を組み立てる。 */
  mailer?: Mailer;
}

export interface BuiltDeps {
  repo: SqliteGameRepository;
  /** better-auth インスタンス。`auth.handler`/`auth.api.*` を web 層 (Phase 6b) から呼ぶ。 */
  auth: ReturnType<typeof createAuth>;
  /**
   * 解決済みの auth secret (better-auth の secret と CSRF トークンの HMAC 鍵)。
   * `HAKONIWA_AUTH_SECRET` があればそれ、無ければ settings 表の自動生成値。
   */
  authSecret: string;
  mailer: Mailer;
  authMethods: AuthMethodPolicy;
  /** 管理者判定 (環境変数 + settings 表) と初期セットアップ。 */
  adminPolicy: AdminPolicy;
  gameService: GameService;
  turnService: TurnService;
  adminService: AdminService;
  config: AppConfig;
  /** ランタイム非依存の Hono app (Phase 4a で追加)。静的配信は Adapter が別途行う。 */
  app: ReturnType<typeof createApp>;
}

/** console ベースの既定ロガー。bootstrap 層 (Adapter 組立コード) でのみ console を直接使う。 */
function createConsoleLogger(): Logger {
  return {
    info: (msg: string) => {
      console.info(msg);
    },
    warn: (msg: string) => {
      console.warn(msg);
    },
    error: (msg: string, err?: unknown) => {
      console.error(msg, err);
    },
  };
}

/**
 * `config.mail` から Mailer を組み立てる。`HAKONIWA_RESEND_API_KEY` が無ければ `ConsoleMailer`
 * (開発用。起動時に警告する)。
 */
function buildMailer(config: AppConfig, logger: Logger): Mailer {
  if (config.mail.resendApiKey === undefined) {
    logger.warn(
      "HAKONIWA_RESEND_API_KEY が未設定のため ConsoleMailer (開発用: メールをログに出力するだけ) を使用します。",
    );
    return new ConsoleMailer(logger);
  }
  return new ResendMailer({ apiKey: config.mail.resendApiKey, from: config.mail.mailFrom });
}

function isMailerConsole(mailer: Mailer): boolean {
  return mailer instanceof ConsoleMailer;
}

/** X/Discord のクライアント ID が設定されているか (email は Mailer が常に存在するため常に true)。 */
function configuredAuthMethods(config: AppConfig): AuthMethodsFlags {
  return {
    x: config.auth.x !== undefined,
    discord: config.auth.discord !== undefined,
    email: true,
  };
}

/** `SqlDriver`/`BackupStore`/`Clock`/`AppConfig` から Service 一式を組み立てる。Adapter 共通の入口。 */
export function buildDeps(input: BuildDepsInput): BuiltDeps {
  const { driver, backupStore, clock, config } = input;
  const rng = input.rng ?? createMathRandomRng();
  const logger = input.logger ?? createConsoleLogger();
  const mailer = input.mailer ?? buildMailer(config, logger);

  const repo = new SqliteGameRepository(driver, {
    islandSize: config.game.islandSize,
    commandMax: config.game.commandMax,
  });
  // settings 表は migrate() で作られる。Adapter (Node の compose.ts、Workers の game-object.ts)
  // はどちらも buildDeps より前に migrate を呼ぶ。
  const settings = new SqliteSettingsRepository(driver);
  const authMethods = new AuthMethodPolicy({
    configured: configuredAuthMethods(config),
    settings,
  });
  const authSecret = resolveAuthSecret(config.auth.secret, settings);
  const adminPolicy = new AdminPolicy({ envEmails: config.auth.adminEmails, settings });
  if (config.adminEnabled && adminPolicy.needsSetup()) {
    logger.warn(
      "管理者が未設定です。ログインしてから /admin/setup を開くと、管理者になるためのセットアップコードをこのログに出力します。",
    );
  }
  const auth = createAuth({ driver, config, secret: authSecret, mailer, authMethods });

  const gameService = new GameService({
    repo,
    clock,
    config: config.game,
    rng,
    ngWords: config.ngWords,
  });

  const turnService = new TurnService({
    repo,
    config: config.game,
    rng,
    backupStore,
    logger,
  });

  const adminService = new AdminService({
    repo,
    clock,
    config: config.game,
    backupStore,
    turnService,
    authMethods,
    mailerIsConsole: isMailerConsole(mailer),
  });

  const webDeps: WebDeps = {
    gameService,
    turnService,
    adminService,
    adminPolicy,
    config,
    authSecret,
    clock,
    auth,
    logger,
  };
  const app = createApp(webDeps);

  return {
    repo,
    auth,
    authSecret,
    mailer,
    authMethods,
    adminPolicy,
    gameService,
    turnService,
    adminService,
    config,
    app,
  };
}
