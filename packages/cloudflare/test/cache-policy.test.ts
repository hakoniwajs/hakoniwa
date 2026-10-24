// cache-policy.ts (Gateway のルーティング・キャッシュキー・props・ヘッダの判定) の単体テスト。
import { describe, expect, it } from "vitest";
import { planGatewayRequest, toBrowserResponse, toCacheableResponse } from "../src/cache-policy.ts";

describe("planGatewayRequest", () => {
  it("OGP 画像は未ログイン扱いで CachedPages 経由にする (Cookie/Authorization は渡さない)", () => {
    const plan = planGatewayRequest(
      new Request("https://hako.example/games/1/islands/2/ogp.png?turn=3", {
        headers: {
          cookie: "hako.session_token=abc",
          authorization: "Bearer x",
          accept: "image/png",
        },
      }),
    );
    expect(plan.kind).toBe("cached");
    if (plan.kind !== "cached") {
      return;
    }
    expect(plan.props).toEqual({ v: 1, viewer: "anonymous" });
    expect(plan.cacheKey).toBe("/games/1/islands/2/ogp.png?turn=3");
    expect(plan.url).toBe("https://hako.example/games/1/islands/2/ogp.png?turn=3");
    expect(plan.method).toBe("GET");
    expect(plan.headers.get("cookie")).toBeNull();
    expect(plan.headers.get("authorization")).toBeNull();
    expect(plan.headers.get("accept")).toBe("image/png");
  });

  it("OGP 画像のクエリは turn (数字) だけを残す", () => {
    const withExtra = planGatewayRequest(
      new Request("https://hako.example/games/1/islands/2/ogp.png?utm_source=x&turn=5&a=b"),
    );
    expect(withExtra.kind === "cached" && withExtra.cacheKey).toBe(
      "/games/1/islands/2/ogp.png?turn=5",
    );
    const invalidTurn = planGatewayRequest(
      new Request("https://hako.example/games/1/islands/2/ogp.png?turn=abc"),
    );
    expect(invalidTurn.kind === "cached" && invalidTurn.cacheKey).toBe(
      "/games/1/islands/2/ogp.png",
    );
    expect(invalidTurn.kind === "cached" && new URL(invalidTurn.url).search).toBe("");
  });

  it("HEAD は HEAD のまま渡す", () => {
    const plan = planGatewayRequest(
      new Request("https://hako.example/games/1/islands/2/ogp.png", { method: "HEAD" }),
    );
    expect(plan.kind === "cached" && plan.method).toBe("HEAD");
  });

  it("POST・WebSocket・対象外のパスは DO へ直接転送する", () => {
    expect(
      planGatewayRequest(
        new Request("https://hako.example/games/1/islands/2/ogp.png", { method: "POST" }),
      ).kind,
    ).toBe("direct");
    expect(
      planGatewayRequest(
        new Request("https://hako.example/games/1/islands/2/ogp.png", {
          headers: { upgrade: "websocket" },
        }),
      ).kind,
    ).toBe("direct");
    for (const path of [
      "/",
      "/games",
      "/games/1",
      "/games/1/islands/2",
      "/games/1/my-island",
      "/admin",
      "/api/auth/get-session",
      "/islands/2/ogp.png",
      "/games/1/islands/2/ogp.png/x",
    ]) {
      expect(planGatewayRequest(new Request(`https://hako.example${path}`)).kind).toBe("direct");
    }
  });
});

describe("toBrowserResponse", () => {
  it("HTML は private, no-store に置き換え、Cache-Tag を消す", () => {
    const res = toBrowserResponse(
      new Response("<p>hi</p>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "public, max-age=60",
          "cache-tag": "game-1",
        },
      }),
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("cache-tag")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
  });

  it("画像は Cache-Control をそのまま残す", () => {
    const res = toBrowserResponse(
      new Response("png", {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=3600",
          "cache-tag": "island-1",
        },
      }),
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("cache-tag")).toBeNull();
  });

  it("ステータスを保つ", () => {
    const res = toBrowserResponse(new Response("nf", { status: 404 }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("toCacheableResponse", () => {
  it("Set-Cookie を含む応答はキャッシュさせない", () => {
    const res = toCacheableResponse(
      new Response("x", {
        headers: {
          "set-cookie": "a=b",
          "cache-control": "public, max-age=60",
          "cache-tag": "game-1",
        },
      }),
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("cache-tag")).toBeNull();
    expect(res.headers.get("set-cookie")).toBe("a=b");
  });

  it("Set-Cookie が無ければ DO の Cache-Control をそのまま使う", () => {
    const res = toCacheableResponse(
      new Response("x", { headers: { "cache-control": "public, max-age=60" } }),
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
