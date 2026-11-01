import { describe, expect, it } from "vite-plus/test";
import { authMethodOf } from "./auth-method-of.ts";

describe("authMethodOf", () => {
  it("/sign-in/social は body.provider から判定する", () => {
    expect(authMethodOf({ path: "/sign-in/social", body: { provider: "twitter" } })).toBe("x");
    expect(authMethodOf({ path: "/sign-in/social", body: { provider: "discord" } })).toBe(
      "discord",
    );
  });

  it("/link-social も body.provider から判定する", () => {
    expect(authMethodOf({ path: "/link-social", body: { provider: "twitter" } })).toBe("x");
  });

  it("未知の provider は undefined", () => {
    expect(authMethodOf({ path: "/sign-in/social", body: { provider: "github" } })).toBeUndefined();
    expect(authMethodOf({ path: "/sign-in/social", body: {} })).toBeUndefined();
  });

  it("/callback/:id はパラメータから判定する", () => {
    expect(authMethodOf({ path: "/callback/:id", params: { id: "twitter" } })).toBe("x");
    expect(authMethodOf({ path: "/callback/:id", params: { id: "discord" } })).toBe("discord");
  });

  it("/sign-in/magic-link と /magic-link/verify は email", () => {
    expect(authMethodOf({ path: "/sign-in/magic-link" })).toBe("email");
    expect(authMethodOf({ path: "/magic-link/verify" })).toBe("email");
  });

  it("対象外のエンドポイントは undefined (制限なし)", () => {
    expect(authMethodOf({ path: "/get-session" })).toBeUndefined();
    expect(authMethodOf({ path: "/sign-out" })).toBeUndefined();
    expect(authMethodOf({ path: "/change-email" })).toBeUndefined();
    expect(authMethodOf({ path: "/unlink-account" })).toBeUndefined();
    expect(authMethodOf({ path: "/dev-login" })).toBeUndefined();
  });
});
