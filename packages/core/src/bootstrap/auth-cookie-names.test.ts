// authCookieNames: better-auth の Cookie 名 (`__Secure-` の有無) が baseUrl に従って決まること。
import { describe, expect, it } from "vitest";
import { authCookieNames } from "./auth.ts";
import { loadConfigFromEnv } from "./config-from-env.ts";

describe("authCookieNames", () => {
  it("HTTPS の baseUrl なら __Secure- を付ける", () => {
    const config = loadConfigFromEnv({ HAKONIWA_BASE_URL: "https://hako.example" });
    expect(authCookieNames(config)).toEqual({
      sessionToken: "__Secure-hako.session_token",
      sessionData: "__Secure-hako.session_data",
    });
  });

  it("HTTP の baseUrl なら付けない", () => {
    const config = loadConfigFromEnv({ HAKONIWA_BASE_URL: "http://localhost:8787" });
    expect(authCookieNames(config)).toEqual({
      sessionToken: "hako.session_token",
      sessionData: "hako.session_data",
    });
  });
});
