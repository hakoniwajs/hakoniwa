import { describe, expect, it } from "vite-plus/test";
import { b, com, disaster, escapeHtml, islandName, name, point } from "./markup.ts";

describe("escapeHtml", () => {
  it("HTML の特殊文字をエスケープする", () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe(
      "&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;",
    );
  });

  it("特殊文字がなければそのまま返す", () => {
    expect(escapeHtml("たろう")).toBe("たろう");
  });
});

describe("name / islandName", () => {
  it("island-name の span で包む", () => {
    expect(name("たろう")).toBe('<span class="island-name">たろう</span>');
  });

  it("islandName は 島 を付けて name() する", () => {
    expect(islandName("たろう")).toBe('<span class="island-name">たろう島</span>');
  });

  it("引数はエスケープされる", () => {
    expect(name("<b>")).toBe('<span class="island-name">&lt;b&gt;</span>');
  });
});

describe("com", () => {
  it("command-name の span で包む", () => {
    expect(com("整地")).toBe('<span class="command-name">整地</span>');
  });

  it("引数はエスケープされる", () => {
    expect(com("<>")).toBe('<span class="command-name">&lt;&gt;</span>');
  });
});

describe("disaster", () => {
  it("disaster の span で包む", () => {
    expect(disaster("地震")).toBe('<span class="disaster">地震</span>');
  });

  it("引数はエスケープされる", () => {
    expect(disaster("&")).toBe('<span class="disaster">&amp;</span>');
  });
});

describe("b", () => {
  it("<b> で包む", () => {
    expect(b("森")).toBe("<b>森</b>");
  });

  it("引数はエスケープされる", () => {
    expect(b("<x>")).toBe("<b>&lt;x&gt;</b>");
  });
});

describe("point", () => {
  it("Perl 版と同じくカンマの後に半角スペースを入れる", () => {
    expect(point(3, 4)).toBe("(3, 4)");
  });

  it("負の座標も表現できる", () => {
    expect(point(-1, 0)).toBe("(-1, 0)");
  });
});
