// loadWorkerConfig: Workers 固有の既定値 (HAKONIWA_MAX_CATCH_UP_TURNS=3) と、
// HAKONIWA_AUTH_SECRET 無しでも設定を組み立てられることの確認。
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import { loadWorkerConfig, WORKERS_DEFAULT_MAX_CATCH_UP_TURNS } from "../src/game-object.ts";

function envOf(vars: Partial<Env>): Env {
  return vars as Env;
}

describe("loadWorkerConfig", () => {
  it("HAKONIWA_MAX_CATCH_UP_TURNS が無ければ Workers 版の既定値 3 になる", () => {
    const config = loadWorkerConfig(envOf({}));
    expect(WORKERS_DEFAULT_MAX_CATCH_UP_TURNS).toBe(3);
    expect(config.game.maxCatchUpTurns).toBe(3);
    expect(config.auth.secret).toBeUndefined();
  });

  it("空文字列も未設定扱いで既定値 3 になる", () => {
    const config = loadWorkerConfig(envOf({ HAKONIWA_MAX_CATCH_UP_TURNS: "" }));
    expect(config.game.maxCatchUpTurns).toBe(3);
  });

  it("HAKONIWA_MAX_CATCH_UP_TURNS を指定すればそれを使う", () => {
    const config = loadWorkerConfig(envOf({ HAKONIWA_MAX_CATCH_UP_TURNS: "5" }));
    expect(config.game.maxCatchUpTurns).toBe(5);
  });
});
