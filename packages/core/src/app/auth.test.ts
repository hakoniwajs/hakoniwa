import { describe, expect, it } from "vite-plus/test";
import { isAdminEmail, toAuthUser } from "./auth.ts";

describe("isAdminEmail", () => {
  it("adminEmails に含まれていれば true", () => {
    expect(isAdminEmail("admin@example.com", ["admin@example.com"])).toBe(true);
  });

  it("大文字小文字を無視して比較する", () => {
    expect(isAdminEmail("Admin@Example.com", ["admin@example.com"])).toBe(true);
    expect(isAdminEmail("admin@example.com", ["Admin@Example.com"])).toBe(true);
  });

  it("adminEmails に含まれていなければ false", () => {
    expect(isAdminEmail("someone@example.com", ["admin@example.com"])).toBe(false);
  });

  it(".invalid で終わるプレースホルダメールは常に false", () => {
    expect(isAdminEmail("admin@x.placeholder.invalid", ["admin@x.placeholder.invalid"])).toBe(
      false,
    );
  });

  it("adminEmails が空なら常に false", () => {
    expect(isAdminEmail("admin@example.com", [])).toBe(false);
  });
});

describe("toAuthUser", () => {
  it("セッションユーザーから AuthUser を組み立てる", () => {
    const user = toAuthUser(
      { id: "u1", name: "たろう", email: "admin@example.com", image: "https://example.com/a.png" },
      ["admin@example.com"],
    );
    expect(user).toEqual({
      id: "u1",
      name: "たろう",
      email: "admin@example.com",
      image: "https://example.com/a.png",
      isAdmin: true,
    });
  });

  it("image が未指定/null なら image フィールドを持たない", () => {
    const user = toAuthUser({ id: "u1", name: "たろう", email: "a@b.c" }, []);
    expect(user).not.toHaveProperty("image");
    expect(user.isAdmin).toBe(false);

    const userWithNullImage = toAuthUser(
      { id: "u1", name: "たろう", email: "a@b.c", image: null },
      [],
    );
    expect(userWithNullImage).not.toHaveProperty("image");
  });

  it("adminEmails に一致しなければ isAdmin は false", () => {
    const user = toAuthUser({ id: "u1", name: "たろう", email: "a@b.c" }, ["admin@example.com"]);
    expect(user.isAdmin).toBe(false);
  });
});
