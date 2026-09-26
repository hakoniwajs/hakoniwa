// ログイン中のページのキャッシュ (Issue #25) の確認:
// - better-auth のセッションの Cookie キャッシュを、Gateway が DO に問い合わせずに検証できること
//   (@hakoniwajs/core の verifySessionCookieCache)
// - Gateway が CachedPages にセッションごとの props (sessionId, rev) を渡すこと
// - DO が状態を変えるリクエストの応答に Cookie `hako_rev` を付けること
// - 管理画面などはキャッシュしないこと
// Workers Cache そのもの (HIT/MISS) はテスト環境では再現されない。
import { reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { loadConfigFromEnv, verifySessionCookieCache } from "@hakoniwajs/core";
import { afterEach, describe, expect, it } from "vitest";
import { clearAuthSecretMemo } from "../src/worker.ts";
import {
  cookieHeaderFrom,
  createIsland,
  fetchWorker,
  loginWithAllCookies,
  mainGameStub,
  recordingContext,
  startGame,
} from "./helpers.ts";

afterEach(async () => {
  await reset();
  // reset() で DO のデータ (自動生成した auth secret を含む) が作り直されるため、
  // Gateway がメモした secret も捨てる。
  clearAuthSecretMemo();
});

const config = loadConfigFromEnv({});

async function authSecret(): Promise<string> {
  return await mainGameStub().authSecret();
}

async function sessionIdOf(cookie: string): Promise<string> {
  const res = await mainGameStub().fetch("http://example.com/api/auth/get-session", {
    headers: { cookie },
  });
  const body: { session?: { id?: string } } | null = await res.json();
  const id = body?.session?.id;
  if (id === undefined) {
    throw new Error("no session");
  }
  return id;
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

function replaceCookie(cookieHeader: string, name: string, value: string): string {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .map((part) => (part.startsWith(`${name}=`) ? `${name}=${value}` : part))
    .join("; ");
}

describe("verifySessionCookieCache (エッジでのセッション検証)", () => {
  it("ログイン時の Cookie (session_token + session_data) を検証でき、DO のセッション ID と一致する", async () => {
    const { cookie } = await loginWithAllCookies();
    expect(cookieValue(cookie, "hako.session_data")).toBeDefined();
    const verified = await verifySessionCookieCache(new Headers({ cookie }), {
      secret: await authSecret(),
      config,
    });
    expect(verified?.sessionId).toBe(await sessionIdOf(cookie));
    // Cookie キャッシュの有効期限は約 5 分後。
    expect(verified?.expiresAt).toBeGreaterThan(Date.now() + 200_000);
    expect(verified?.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it("secret が違う・Cookie キャッシュが改ざんされている・無い場合は検証できない", async () => {
    const { cookie } = await loginWithAllCookies();
    const secret = await authSecret();

    expect(
      await verifySessionCookieCache(new Headers({ cookie }), { secret: "wrong-secret", config }),
    ).toBeUndefined();

    const data = cookieValue(cookie, "hako.session_data") ?? "";
    // payload の中身 (JSON) を書き換える: セッション ID を別の値にする。
    const decoded = JSON.parse(atob(data.replace(/-/g, "+").replace(/_/g, "/"))) as {
      session: { session: { id: string } };
    };
    decoded.session.session.id = "someone-else";
    const tampered = btoa(JSON.stringify(decoded))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      await verifySessionCookieCache(
        new Headers({ cookie: replaceCookie(cookie, "hako.session_data", tampered) }),
        { secret, config },
      ),
    ).toBeUndefined();

    const withoutData = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith("hako.session_data="))
      .join("; ");
    expect(
      await verifySessionCookieCache(new Headers({ cookie: withoutData }), { secret, config }),
    ).toBeUndefined();
  });

  it("セッショントークンの Cookie と一致しなければ検証できない (別のセッションのトークン)", async () => {
    const a = await loginWithAllCookies("a@example.com");
    const b = await loginWithAllCookies("b@example.com");
    const secret = await authSecret();
    const mixed = replaceCookie(
      a.cookie,
      "hako.session_token",
      cookieValue(b.cookie, "hako.session_token") ?? "",
    );
    expect(
      await verifySessionCookieCache(new Headers({ cookie: mixed }), { secret, config }),
    ).toBeUndefined();
    const withoutToken = a.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith("hako.session_token="))
      .join("; ");
    expect(
      await verifySessionCookieCache(new Headers({ cookie: withoutToken }), { secret, config }),
    ).toBeUndefined();
  });
});

describe("Gateway (ログイン中のページ)", () => {
  it("検証できたセッションは、セッションごとの props で CachedPages を呼ぶ", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "いちごう");
    const sessionId = await sessionIdOf(cookie);

    for (const path of ["/games", "/games/1", "/games/1/islands/1", "/games/1/my-island"]) {
      const recording = recordingContext();
      const res = await fetchWorker(
        `http://example.com${path}?utm_source=x`,
        { headers: { cookie: `${cookie}; theme=dark` } },
        { ctx: recording },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-hakoniwa-route")).toBe("cached");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      // Cookie キャッシュが有効な間は DO が Cookie を作り直さないので、Set-Cookie は無い
      // (Set-Cookie 付きの応答は Workers Cache に保存されない)。
      expect(res.headers.get("set-cookie")).toBeNull();
      const html = await res.text();
      // ログイン中として描画されている。
      expect(html).toContain('href="/my-island"');
      expect(html).toContain(`value="${csrfToken}"`);

      expect(recording.calls).toHaveLength(1);
      const call = recording.calls[0];
      expect(call?.props).toEqual({
        v: 1,
        viewer: "session",
        sessionId,
        rev: cookieValue(cookie, "hako_rev"),
        origin: "http://example.com",
      });
      expect(call?.url).toBe(`http://example.com${path}`);
      expect(call?.init?.cf).toEqual({ cacheKey: path });
      // DO には better-auth の Cookie だけを渡す。
      const forwardedCookie = new Headers(call?.init?.headers).get("cookie") ?? "";
      expect(forwardedCookie).toContain("hako.session_token=");
      expect(forwardedCookie).toContain("hako.session_data=");
      expect(forwardedCookie).not.toContain("theme=");
    }
  });

  it("トップの ?notice=no_island は残す", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1?notice=no_island",
      { headers: { cookie } },
      { ctx: recording },
    );
    expect(res.status).toBe(200);
    expect(recording.calls[0]?.init?.cf).toEqual({ cacheKey: "/games/1?notice=no_island" });
  });

  it("POST の応答は hako_rev を付け、その後の GET の props.rev になる", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    await createIsland(cookie, csrfToken, 1, "にごう");

    const postRes = await fetchWorker("http://example.com/games/1/my-island/comment", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `message=${encodeURIComponent("こんにちは")}&_csrf=${encodeURIComponent(csrfToken)}`,
    });
    expect(postRes.status).toBe(200);
    expect(postRes.headers.get("x-hakoniwa-route")).toBe("direct");
    const revCookie = postRes.headers.getSetCookie().find((value) => value.startsWith("hako_rev="));
    expect(revCookie).toMatch(
      /^hako_rev=[0-9a-z]+; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/,
    );
    // POST の応答では Cookie キャッシュを作り直さない (ログアウトで消した Cookie を戻さないため)。
    expect(
      postRes.headers.getSetCookie().some((value) => value.startsWith("hako.session_data=")),
    ).toBe(false);

    const nextCookie = cookieHeaderFrom(postRes, cookie);
    const rev = cookieValue(nextCookie, "hako_rev");
    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1",
      { headers: { cookie: nextCookie } },
      { ctx: recording },
    );
    expect(await res.text()).toContain("こんにちは");
    expect(recording.calls[0]?.props).toMatchObject({ rev });

    // 次の POST ではさらに新しい値になる。
    const secondPost = await fetchWorker("http://example.com/games/1/my-island/comment", {
      method: "POST",
      headers: { cookie: nextCookie, "content-type": "application/x-www-form-urlencoded" },
      body: `message=x&_csrf=${encodeURIComponent(csrfToken)}`,
    });
    const secondRev = cookieValue(cookieHeaderFrom(secondPost, nextCookie), "hako_rev");
    expect(secondRev).not.toBe(rev);
    expect(parseInt(secondRev ?? "0", 36)).toBeGreaterThan(parseInt(rev ?? "0", 36));
  });

  it("Cookie キャッシュが無い (期限切れ) ログイン中のリクエストは DO へ直接転送し、Cookie キャッシュを作り直す", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    const tokenOnly = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith("hako.session_data="))
      .join("; ");

    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1",
      { headers: { cookie: tokenOnly } },
      { ctx: recording },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-hakoniwa-route")).toBe("direct");
    expect(recording.calls).toHaveLength(0);
    expect(await res.text()).toContain('href="/my-island"');
    // GET の応答で Cookie キャッシュを作り直すので、次のリクエストからは検証できる。
    const refreshed = cookieHeaderFrom(res, tokenOnly);
    expect(cookieValue(refreshed, "hako.session_data")).toBeDefined();
    const next = recordingContext();
    await fetchWorker(
      "http://example.com/games/1",
      { headers: { cookie: refreshed } },
      {
        ctx: next,
      },
    );
    expect(next.calls).toHaveLength(1);
  });

  it("管理画面・アカウント設定・ログイン・better-auth の API はキャッシュしない", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    for (const path of [
      "/admin",
      "/account",
      "/login",
      "/api/auth/get-session",
      "/",
      "/games/1/islands/1/lbbs",
    ]) {
      const recording = recordingContext();
      const res = await fetchWorker(
        `http://example.com${path}`,
        { headers: { cookie } },
        {
          ctx: recording,
        },
      );
      expect(res.headers.get("x-hakoniwa-route"), path).toBe("direct");
      expect(recording.calls, path).toHaveLength(0);
    }
  });

  it("ログアウトの応答は Cookie キャッシュを消し、付け直さない", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    const res = await fetchWorker("http://example.com/logout", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `_csrf=${encodeURIComponent(csrfToken)}`,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const after = cookieHeaderFrom(res, cookie);
    expect(cookieValue(after, "hako.session_data")).toBeUndefined();
    expect(cookieValue(after, "hako.session_token")).toBeUndefined();
    expect(cookieValue(after, "hako_rev")).toBeDefined();
  });

  it("表示名の変更は Cookie キャッシュを作り直し、次のページにすぐ反映される", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    const postRes = await fetchWorker("http://example.com/account/name", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: `name=${encodeURIComponent("あたらしいなまえ")}&_csrf=${encodeURIComponent(csrfToken)}`,
    });
    expect(postRes.status).toBe(200);
    expect(await postRes.text()).toContain("あたらしいなまえ");
    const nextCookie = cookieHeaderFrom(postRes, cookie);
    expect(cookieValue(nextCookie, "hako.session_data")).not.toBe(
      cookieValue(cookie, "hako.session_data"),
    );
    const recording = recordingContext();
    const res = await fetchWorker(
      "http://example.com/games/1",
      { headers: { cookie: nextCookie } },
      { ctx: recording },
    );
    expect(recording.calls).toHaveLength(1);
    expect(await res.text()).toContain("あたらしいなまえさん");
  });

  it("CachedPages はセッションの props でも、Cookie キャッシュが有効なら public で返す", async () => {
    const { cookie, csrfToken } = await loginWithAllCookies();
    await startGame(cookie, csrfToken);
    await mainGameStub().checkTurn();
    const loopback = (exports as unknown as Record<string, (opts: { props: unknown }) => Fetcher>)[
      "CachedPages"
    ];
    const res = await loopback?.({
      props: {
        v: 1,
        viewer: "session",
        sessionId: await sessionIdOf(cookie),
        rev: "",
        origin: "http://example.com",
      },
    }).fetch("http://example.com/games/1", { headers: { cookie } });
    expect(res?.status).toBe(200);
    expect(res?.headers.get("set-cookie")).toBeNull();
    expect(res?.headers.get("cache-control")).toMatch(
      /^public, max-age=\d+, stale-while-revalidate=60$/,
    );
  });
});
