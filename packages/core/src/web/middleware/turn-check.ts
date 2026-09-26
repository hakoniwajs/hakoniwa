// tmp/08-turn-trigger-admin-cli.md 「トリガー 1: リクエスト時 (lazy)」節の移植。
import type { MiddlewareHandler } from "hono";
import type { Clock } from "../../app/ports.ts";
import type { TurnService } from "../../app/turn-service.ts";

export interface TurnCheckDeps {
  turnService: TurnService;
  clock: Clock;
}

/**
 * ゲーム系ルートの前に `advanceTurnIfDue` を同期実行する。`/admin/*` と静的には掛けない。
 *
 * repo が未初期化のとき `TurnService.advanceTurnIfDue` (内部で `repo.getMeta()`
 * を呼ぶ) は通常の `Error` を throw する (`AppError('not_initialized')` ではない)。
 * ここで catch せずに投げっぱなしにすると `app.onError` の想定外エラー分岐 (500) に落ちてしまい、
 * 06 の表が定める `not_initialized` (503) にたどり着けない。
 * ターン進行の失敗は「進めなかった」として無視し、後続のルートハンドラ (GameService 各メソッドの
 * `#ensureInitialized`) に本来の 503 判定を委ねる。
 */
export function turnCheckMiddleware(deps: TurnCheckDeps): MiddlewareHandler {
  return async (c, next) => {
    try {
      deps.turnService.advanceTurnIfDue(deps.clock.now());
    } catch {
      // 未初期化などでターン進行できない場合は無視し、後続のルートに判定を委ねる。
    }
    await next();
  };
}
