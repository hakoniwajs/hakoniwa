// @hakoniwajs/core の公開 API。
// Phase 0 時点では core の主要な型・関数のみを re-export する。
// Adapter 向け API (buildDeps, migrate 等) は Phase 3 以降で追加する。

export type { GameConfig, GameUnits, DisasterConfig, OilConfig } from "./core/config.ts";
export { defaultConfig } from "./core/config.ts";

export type { CommandSpec, MonsterSpec, MonsterSpecial } from "./core/constants.ts";
export {
  LandKind,
  CommandKind,
  commandList,
  commandSpecs,
  monsters,
  monuments,
  prizeNames,
  PrizeFlag,
} from "./core/constants.ts";

export type {
  Hex,
  Terrain,
  Command,
  Prize,
  LbbsAuthor,
  LbbsPost,
  Island,
  TurnIslandState,
  World,
  LogEntry,
  HistoryEntry,
} from "./core/types.ts";
export { doNothingCommand } from "./core/types.ts";

export type { Rng } from "./core/rng.ts";
export { createMathRandomRng, createSeededRng, randomArray } from "./core/rng.ts";

export type { Point } from "./core/geometry.ts";
export {
  AX,
  AY,
  neighbor,
  neighbors,
  inBounds,
  countAround,
  shuffledPoints,
} from "./core/geometry.ts";

export {
  createTerrain,
  terrainFromJSON,
  landName,
  monsterSpec,
  expToLevel,
  isHardened,
} from "./core/terrain.ts";

export type { TileMode, TileView } from "./core/tile.ts";
export { tileFor } from "./core/tile.ts";

export type { NewIslandInit } from "./core/island.ts";
export { makeNewLand, makeNewIsland, estimate } from "./core/island.ts";

export { IGNORED_LIST_ENTRIES, findNgWord } from "./core/ng-words.ts";

export type { AutoPrepareKind } from "./core/commands/queue.ts";
export {
  slideFront,
  slideBack,
  writeAt,
  insertAt,
  deleteAt,
  clearAll,
  autoPrepare,
} from "./core/commands/queue.ts";

export type { FormattedCommand, ResolveIslandName } from "./core/commands/format.ts";
export { formatCommand } from "./core/commands/format.ts";

export type { FlagPrizeView, KilledMonstersView } from "./core/prize.ts";
export {
  hasFlag,
  withFlag,
  withMonster,
  withTurnPrize,
  turnPrizes,
  flagPrizes,
  killedMonsters,
} from "./core/prize.ts";

export * as logMarkup from "./core/log/markup.ts";
export * as logMessages from "./core/log/messages.ts";
export { LogCollector } from "./core/log/collector.ts";

export type { TurnContext } from "./core/turn/context.ts";
export { getState, findIsland } from "./core/turn/context.ts";
export { income } from "./core/turn/income.ts";
export { wideDamage } from "./core/turn/wide-damage.ts";
export type { CommandOutcome } from "./core/turn/command.ts";
export { doCommand } from "./core/turn/command.ts";
export { doPrepare, doReclaim, doDestroy, doSellTree } from "./core/turn/command-land.ts";
export { doBuild, doMountain, doSbase } from "./core/turn/command-build.ts";
export { doSendMonster, doSell, doAid, doPropaganda, doGiveup } from "./core/turn/command-misc.ts";
export { doMissile } from "./core/turn/missile.ts";
export { doEachHex, countGrow } from "./core/turn/each-hex.ts";
export { doIslandProcess } from "./core/turn/island-process.ts";
export { islandSort } from "./core/turn/sort.ts";
export type { TurnResult, CreateTurnContextInput } from "./core/turn/index.ts";
export { runTurn, createTurnContext } from "./core/turn/index.ts";

// ----------------------------------------------------------------------
// app 層 (Phase 3a)。ports の型、ユースケース (Service)、画面向け DTO。
// ----------------------------------------------------------------------

export type {
  GameMeta,
  GameStatus,
  GameSummary,
  CreateGameInput,
  IslandSummary,
  ListLogsQuery,
  GameRepository,
  BackupInfo,
  BackupStore,
  Clock,
  Logger,
  Mailer,
  SettingsRepository,
  UserPrefs,
} from "./app/ports.ts";

export type { AppErrorKind } from "./app/errors.ts";
export { AppError } from "./app/errors.ts";

export type { AuthUser, SessionUserLike } from "./app/auth.ts";
export { isAdminEmail, toAuthUser } from "./app/auth.ts";

export type { AuthMethodKind, AuthMethodsFlags, AuthMethodPolicyDeps } from "./app/auth-methods.ts";
export { AuthMethodPolicy } from "./app/auth-methods.ts";

export type { AdminEmailsVM, AdminPolicyDeps } from "./app/admin-policy.ts";
export {
  ADMIN_EMAILS_SETTINGS_KEY,
  ADMIN_SETUP_CODE_SETTINGS_KEY,
  AdminPolicy,
} from "./app/admin-policy.ts";

export {
  MAX_NAME_LEN,
  MAX_COMMENT_LEN,
  MAX_LBBS_NAME_LEN,
  MAX_LBBS_MESSAGE_LEN,
  stripControlAndComma,
  cutColumn,
  sanitizeText,
  isBadIslandName,
} from "./app/sanitize.ts";

export type {
  MoneyDisplay,
  PrizeVM,
  IslandRowVM,
  ViewerVM,
  GameHeaderVM,
  TopPageVM,
  IslandDetailVM,
  IslandPageVM,
  IslandOgpVM,
  OwnerPageVM,
  NewIslandVM,
  IslandSelectVM,
  GameListItemVM,
} from "./app/view-models.ts";
export { aboutMoney, buildMoneyDisplay, buildIslandOgpVM } from "./app/view-models.ts";

export type { GameServiceDeps, CommandInput } from "./app/game-service.ts";
export { GameService } from "./app/game-service.ts";

export type { TurnServiceDeps } from "./app/turn-service.ts";
export { TurnService } from "./app/turn-service.ts";

export type {
  AdminStatus,
  AdminServiceDeps,
  AdminInitializeOptions,
  StartGameOptions,
  AuthMethodsVM,
} from "./app/admin-service.ts";
export { AdminService } from "./app/admin-service.ts";

export type { SeasonState, SeasonVM } from "./app/season.ts";
export { isFinished, isBeforeStart, buildSeasonVM } from "./app/season.ts";

export { parseLocalDateTime, formatDateTime, formatDateTimeLocalValue } from "./app/timezone.ts";

export type {
  SiteInfo,
  SiteSettings,
  SiteRenderSettings,
  SiteSettingsReader,
  SiteSettingsServiceDeps,
} from "./app/site-settings.ts";
export {
  defaultSiteSettings,
  isValidTimeZone,
  parseNgWordsText,
  SiteSettingsService,
  toSiteRenderSettings,
} from "./app/site-settings.ts";

export {
  formatDuration,
  formatTurnLabel,
  GAME_NOT_STARTED_LABEL,
  parseDuration,
} from "./app/format.ts";

export {
  FakeGameRepository,
  FakeClock,
  FakeBackupStore,
  FakeLogger,
  FakeSettingsRepository,
  FakeMailer,
} from "./app/fake-repository.ts";

// ----------------------------------------------------------------------
// storage 層 (Phase 3b)。SqlDriver、マイグレーション、実 SQLite リポジトリ。
// ----------------------------------------------------------------------

export type { SqlDriver, SqlParam } from "./storage/driver.ts";
export { SCHEMA_VERSION, schemaSql } from "./storage/schema.ts";
export { migrate } from "./storage/migrate.ts";
export type { SqliteGameRepositoryConfig } from "./storage/repository.ts";
export { SqliteGameRepository } from "./storage/repository.ts";
export { betterAuthSqliteAdapter } from "./storage/better-auth-adapter.ts";
export { SqliteSettingsRepository } from "./storage/settings-repository.ts";

// ----------------------------------------------------------------------
// bootstrap 層 (Phase 3b/6a)。env → 設定、better-auth の組立、Adapter 共通の組立。
// ----------------------------------------------------------------------

export type {
  AppConfig,
  AuthConfig,
  MailConfig,
  OAuthClientConfig,
} from "./bootstrap/config-from-env.ts";
export { loadConfigFromEnv } from "./bootstrap/config-from-env.ts";
export type { BuildDepsInput, BuiltDeps } from "./bootstrap/build-deps.ts";
export { buildDeps } from "./bootstrap/build-deps.ts";
export type { CreateAuthInput } from "./bootstrap/auth.ts";
export { createAuth } from "./bootstrap/auth.ts";
export { devLoginPlugin } from "./bootstrap/dev-login-plugin.ts";
export { createCsrfToken, verifyCsrfToken } from "./bootstrap/csrf.ts";
export { AUTH_SECRET_SETTINGS_KEY, resolveAuthSecret } from "./bootstrap/auth-secret.ts";
export type { AuthMethodOfInput } from "./bootstrap/auth-method-of.ts";
export { authMethodOf } from "./bootstrap/auth-method-of.ts";
export type { ResendMailerConfig } from "./bootstrap/mailer.ts";
export { ConsoleMailer, ResendMailer } from "./bootstrap/mailer.ts";

// ----------------------------------------------------------------------
// web 層 (Phase 4a)。ランタイム非依存の Hono app。静的配信は Adapter の責務。
// ----------------------------------------------------------------------

export type { AppEnv } from "./web/env.ts";
export type { WebDeps } from "./web/deps.ts";
export { createApp } from "./web/app.tsx";

// tmp/21-kv-snapshot-cache.md: Worker 側 (DO を経由しない) でトップ/観光ページを描画するための
// レンダリング関数。既存の web 層の View (Layout/TopPage/IslandPage) をそのまま使う。
export type { RenderIslandPageHtmlInput, RenderTopPageHtmlInput } from "./web/render-snapshot.tsx";
export { renderIslandPageHtml, renderTopPageHtml } from "./web/render-snapshot.tsx";

// ----------------------------------------------------------------------
// OGP 画像 (tmp/17-ogp.md)。PNG エンコードと島の地図の描画。
// ----------------------------------------------------------------------

export { encodePng } from "./ogp/png.ts";
export { OGP_WIDTH, OGP_HEIGHT, renderIslandOgp } from "./ogp/render.ts";
