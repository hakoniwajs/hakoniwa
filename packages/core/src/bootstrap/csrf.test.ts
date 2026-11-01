import { describe, expect, it } from "vite-plus/test";
import { createCsrfToken, verifyCsrfToken } from "./csrf.ts";

describe("createCsrfToken / verifyCsrfToken", () => {
  it("同じ secret/sessionId なら同じトークンになる", async () => {
    const a = await createCsrfToken("secret1", "session1");
    const b = await createCsrfToken("secret1", "session1");
    expect(a).toBe(b);
  });

  it("sessionId が異なればトークンも異なる", async () => {
    const a = await createCsrfToken("secret1", "session1");
    const b = await createCsrfToken("secret1", "session2");
    expect(a).not.toBe(b);
  });

  it("secret が異なればトークンも異なる", async () => {
    const a = await createCsrfToken("secret1", "session1");
    const b = await createCsrfToken("secret2", "session1");
    expect(a).not.toBe(b);
  });

  it("base64url のみで構成される (+, /, = を含まない)", async () => {
    const token = await createCsrfToken("secret1", "session1");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("正しいトークンなら verify が true", async () => {
    const token = await createCsrfToken("secret1", "session1");
    expect(await verifyCsrfToken("secret1", "session1", token)).toBe(true);
  });

  it("誤ったトークンなら verify が false", async () => {
    expect(await verifyCsrfToken("secret1", "session1", "invalid")).toBe(false);
  });

  it("空文字は常に false", async () => {
    expect(await verifyCsrfToken("secret1", "session1", "")).toBe(false);
  });

  it("secret や sessionId が違えば verify が false", async () => {
    const token = await createCsrfToken("secret1", "session1");
    expect(await verifyCsrfToken("secret1", "session2", token)).toBe(false);
    expect(await verifyCsrfToken("secret2", "session1", token)).toBe(false);
  });
});
