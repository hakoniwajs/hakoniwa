// cache-policy.ts (Gateway のルーティング・キャッシュキー・props・ヘッダの判定) の単体テスト。
import { describe, expect, it } from "vitest";
import {
  cookieNames,
  hasAuthCookie,
  planGatewayRequest,
  toBrowserResponse,
  toCacheableResponse,
  toDirectResponse,
} from "../src/cache-policy.ts";

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
      "/games/",
      "/games/1/",
      "/games/x",
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

describe("planGatewayRequest (HTML のページ)", () => {
  it("Cookie の無い GET の /games・/games/:id・/games/:id/islands/:id は未ログイン扱いで CachedPages 経由", () => {
    for (const path of ["/games", "/games/1", "/games/12/islands/34"]) {
      const plan = planGatewayRequest(
        new Request(`https://hako.example${path}`, {
          headers: { accept: "text/html", "accept-language": "ja", authorization: "Bearer x" },
        }),
      );
      expect(plan.kind).toBe("cached");
      if (plan.kind !== "cached") {
        continue;
      }
      expect(plan.props).toEqual({ v: 1, viewer: "anonymous", origin: "https://hako.example" });
      expect(plan.cacheKey).toBe(path);
      expect(plan.url).toBe(`https://hako.example${path}`);
      expect([...plan.headers.keys()]).toEqual(["accept"]);
    }
  });

  it("クエリはすべて落とす (DO にも渡さない)", () => {
    const plan = planGatewayRequest(
      new Request("https://hako.example/games/1?notice=no_island&utm_source=x"),
    );
    expect(plan.kind === "cached" && plan.cacheKey).toBe("/games/1");
    expect(plan.kind === "cached" && plan.url).toBe("https://hako.example/games/1");
  });

  it("オリジンが違えば props も変わる (Host はキャッシュキーに含まれないため)", () => {
    const a = planGatewayRequest(new Request("https://a.example/games/1"));
    const b = planGatewayRequest(new Request("https://b.example/games/1"));
    expect(a.kind === "cached" && a.props).not.toEqual(b.kind === "cached" && b.props);
  });

  it("better-auth の Cookie を持つリクエストは DO へ直接転送する", () => {
    for (const cookie of [
      "hako.session_token=abc",
      "other=1; hako.session_data=xyz",
      "__Secure-hako.session_token=abc",
      "__Secure-hako.session_data.0=abc",
      "hako.dont_remember=true",
    ]) {
      expect(
        planGatewayRequest(new Request("https://hako.example/games/1", { headers: { cookie } }))
          .kind,
      ).toBe("direct");
    }
  });

  it("関係の無い Cookie だけなら未ログイン扱い (Cookie は DO に渡さない)", () => {
    const plan = planGatewayRequest(
      new Request("https://hako.example/games/1", {
        headers: { cookie: "theme=dark; hako_rev=abc; xhako.session_token=1" },
      }),
    );
    expect(plan.kind).toBe("cached");
    expect(plan.kind === "cached" && plan.headers.get("cookie")).toBeNull();
  });

  it("POST・HEAD", () => {
    expect(
      planGatewayRequest(new Request("https://hako.example/games/1", { method: "POST" })).kind,
    ).toBe("direct");
    const head = planGatewayRequest(new Request("https://hako.example/games", { method: "HEAD" }));
    expect(head.kind === "cached" && head.method).toBe("HEAD");
  });
});

describe("cookieNames / hasAuthCookie", () => {
  it("Cookie ヘッダの名前を取り出す", () => {
    expect(cookieNames(null)).toEqual([]);
    expect(cookieNames("a=1; b=2;c; =x")).toEqual(["a", "b", "c"]);
  });

  it("better-auth の Cookie の有無", () => {
    const req = (cookie: string) => new Request("https://hako.example/", { headers: { cookie } });
    expect(hasAuthCookie(new Request("https://hako.example/"))).toBe(false);
    expect(hasAuthCookie(req("hako_rev=1"))).toBe(false);
    expect(hasAuthCookie(req("hako.session_token=1"))).toBe(true);
    expect(hasAuthCookie(req("__Host-hako.x=1"))).toBe(true);
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
    expect(res.headers.get("x-hakoniwa-route")).toBe("cached");
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

  it("200 でキャッシュの目安があれば public + 目安と Cache-Tag に変換し、内部ヘッダを消す", () => {
    const res = toCacheableResponse(
      new Response("<p>x</p>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "cache-control": "private, no-store",
          "x-hakoniwa-cache-control": "max-age=30, stale-while-revalidate=60",
          "x-hakoniwa-cache-tag": "game-1,island-1-2",
        },
      }),
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(res.headers.get("cache-tag")).toBe("game-1,island-1-2");
    expect(res.headers.get("x-hakoniwa-cache-control")).toBeNull();
    expect(res.headers.get("x-hakoniwa-cache-tag")).toBeNull();
  });

  it("200 以外や Set-Cookie 付きなら目安があってもキャッシュさせない", () => {
    const notFound = toCacheableResponse(
      new Response("x", {
        status: 404,
        headers: {
          "cache-control": "private, no-store",
          "x-hakoniwa-cache-control": "max-age=60",
        },
      }),
    );
    expect(notFound.headers.get("cache-control")).toBe("private, no-store");
    expect(notFound.headers.get("x-hakoniwa-cache-control")).toBeNull();

    const withCookie = toCacheableResponse(
      new Response("x", {
        status: 200,
        headers: {
          "set-cookie": "a=b",
          "cache-control": "private, no-store",
          "x-hakoniwa-cache-control": "max-age=60",
          "x-hakoniwa-cache-tag": "game-1",
        },
      }),
    );
    expect(withCookie.headers.get("cache-control")).toBe("private, no-store");
    expect(withCookie.headers.get("cache-tag")).toBeNull();
  });

  it("Set-Cookie が無ければ DO の Cache-Control をそのまま使う", () => {
    const res = toCacheableResponse(
      new Response("x", { headers: { "cache-control": "public, max-age=60" } }),
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("toDirectResponse", () => {
  it("内部ヘッダを消し、経路のヘッダを付ける", () => {
    const res = toDirectResponse(
      new Response("x", {
        status: 302,
        headers: {
          location: "/login",
          "cache-control": "private, no-store",
          "x-hakoniwa-cache-control": "max-age=60",
          "x-hakoniwa-cache-tag": "game-1",
        },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-hakoniwa-cache-control")).toBeNull();
    expect(res.headers.get("x-hakoniwa-cache-tag")).toBeNull();
    expect(res.headers.get("x-hakoniwa-route")).toBe("direct");
  });
});
