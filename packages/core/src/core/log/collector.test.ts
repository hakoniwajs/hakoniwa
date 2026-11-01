import { describe, expect, it } from "vite-plus/test";
import { LogCollector } from "./collector.ts";

describe("LogCollector", () => {
  it("flush は secret を逆順 → late を逆順 → normal を逆順の順で並べ、seq を 0 から振る", () => {
    const log = new LogCollector(7);
    log.normal("n1", 1);
    log.normal("n2", 1);
    log.late("l1", 1);
    log.late("l2", 1);
    log.secret("s1", 1);
    log.secret("s2", 1);

    const { logs } = log.flush();
    expect(logs.map((l) => l.html)).toEqual(["s2", "s1", "l2", "l1", "n2", "n1"]);
    expect(logs.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("normal/late は secret: false, secret() は secret: true になる", () => {
    const log = new LogCollector(1);
    log.normal("n", 1);
    log.late("l", 1);
    log.secret("s", 1);
    const { logs } = log.flush();
    const byHtml = new Map(logs.map((l) => [l.html, l]));
    expect(byHtml.get("n")?.secret).toBe(false);
    expect(byHtml.get("l")?.secret).toBe(false);
    expect(byHtml.get("s")?.secret).toBe(true);
  });

  it("turn / islandId / targetId (省略時 0) が正しく設定される", () => {
    const log = new LogCollector(42);
    log.normal("a", 3);
    log.normal("b", 3, 9);
    const { logs } = log.flush();
    const a = logs.find((l) => l.html === "a")!;
    const b = logs.find((l) => l.html === "b")!;
    expect(a.turn).toBe(42);
    expect(a.islandId).toBe(3);
    expect(a.targetId).toBe(0);
    expect(b.targetId).toBe(9);
  });

  it("history は turn/html の配列としてそのままの順で返る", () => {
    const log = new LogCollector(5);
    log.history("h1");
    log.history("h2");
    const { history } = log.flush();
    expect(history).toEqual([
      { turn: 5, html: "h1" },
      { turn: 5, html: "h2" },
    ]);
  });

  it("何も積まなければ空配列を返す", () => {
    const log = new LogCollector(1);
    const { logs, history } = log.flush();
    expect(logs).toEqual([]);
    expect(history).toEqual([]);
  });
});
