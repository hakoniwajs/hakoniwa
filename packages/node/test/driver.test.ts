import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { NodeSqliteDriver } from "../src/driver.ts";

function createDriver(): NodeSqliteDriver {
  const driver = new NodeSqliteDriver(":memory:");
  driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT) STRICT");
  return driver;
}

describe("NodeSqliteDriver", () => {
  it("run/get/all で読み書きできる", () => {
    const driver = createDriver();
    driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 1, "a");
    driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 2, "b");
    expect(driver.get<{ id: number; v: string }>("SELECT * FROM t WHERE id = ?", 1)).toEqual({
      id: 1,
      v: "a",
    });
    expect(driver.all<{ id: number; v: string }>("SELECT * FROM t ORDER BY id")).toEqual([
      { id: 1, v: "a" },
      { id: 2, v: "b" },
    ]);
    expect(driver.get("SELECT * FROM t WHERE id = 999")).toBeUndefined();
  });

  it("transaction はコミットすると変更が残る", () => {
    const driver = createDriver();
    driver.transaction(() => {
      driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 1, "a");
    });
    expect(driver.all("SELECT * FROM t")).toHaveLength(1);
  });

  it("transaction は fn 内で throw すると ROLLBACK される", () => {
    const driver = createDriver();
    driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 1, "a");
    expect(() =>
      driver.transaction(() => {
        driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 2, "b");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // トランザクション前の 1 行だけが残り、2 は追加されていない。
    expect(driver.all<{ id: number }>("SELECT * FROM t ORDER BY id").map((r) => r.id)).toEqual([1]);
  });

  it("SELECT changes() で直前の UPDATE/INSERT の更新件数が取れる", () => {
    const driver = createDriver();
    driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 1, "a");
    driver.run("UPDATE t SET v = ? WHERE id = ?", "z", 1);
    expect(driver.get<{ n: number }>("SELECT changes() AS n")).toEqual({ n: 1 });

    // 条件に一致しない UPDATE は changes() が 0 になる。
    driver.run("UPDATE t SET v = ? WHERE id = ?", "z", 999);
    expect(driver.get<{ n: number }>("SELECT changes() AS n")).toEqual({ n: 0 });
  });

  it("close 後は同じインスタンスのメソッドを呼ぶとエラーになる (reopen で復帰できる)", () => {
    const driver = createDriver();
    driver.run("INSERT INTO t (id, v) VALUES (?, ?)", 1, "a");
    driver.close();
    expect(() => driver.all("SELECT * FROM t")).toThrow();
  });

  it("動作確認用: DatabaseSync が Node 上で使えること自体を確認する", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE x (id INTEGER)");
    expect(db.prepare("SELECT * FROM x").all()).toEqual([]);
    db.close();
  });
});
