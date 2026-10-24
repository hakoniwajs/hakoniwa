// worker.ts (Gateway) 経由の経路を確かめるテストの共通処理。
// `worker.ts` の `getGame()` は常に `env.GAME.idFromName("main")` を使う (本番は世界が 1 つの
// ため) ので、これらのヘルパはすべて "main" の DO を操作する。各テストファイルは `afterEach` で
// `reset()` を呼び、テストを独立させること。
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/worker.ts";
import type { Env } from "../src/env.ts";

export function mainGameStub() {
  const id = env.GAME.idFromName("main");
  return env.GAME.get(id);
}

/**
 * `worker.ts` の `export default.fetch` を直接呼ぶ (Worker のトップレベルの経路)。
 * `ctx` を渡さなければ `createExecutionContext()` の本物の ctx (`ctx.exports.CachedPages` を含む)
 * を使う。
 */
export async function fetchWorker(
  url: string,
  init?: RequestInit,
  options: { env?: Env; ctx?: RecordingContext } = {},
): Promise<Response> {
  if (options.ctx !== undefined) {
    const res = await worker.fetch(new Request(url, init), options.env ?? env, options.ctx.ctx);
    await options.ctx.wait();
    return res;
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), options.env ?? env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** CachedPages の呼び出しを記録するための、`ctx.exports.CachedPages` の代わり。 */
export interface RecordedCachedPagesCall {
  props: unknown;
  url: string;
  init: RequestInit | undefined;
}

/**
 * `ctx.exports` だけを差し替えた ExecutionContext を作る。`CachedPages` を呼ぶと呼び出しを
 * 記録したうえで、本物の `ctx.exports.CachedPages` (キャッシュ層はテスト環境では再現されない)
 * へそのまま渡す。`withCachedPages: false` なら `CachedPages` の無い exports にする
 * (利用側が再エクスポートしていない古い設定の再現)。
 */
export interface RecordingContext {
  ctx: ExecutionContext;
  calls: RecordedCachedPagesCall[];
  /** `ctx.waitUntil` に渡した処理を待つ。 */
  wait: () => Promise<void>;
}

export function recordingContext(options: { withCachedPages?: boolean } = {}): RecordingContext {
  const real = createExecutionContext();
  const calls: RecordedCachedPagesCall[] = [];
  const realExports = real.exports as unknown as Record<
    string,
    (opts: { props: unknown }) => Fetcher
  >;
  const cachedPages = (opts: { props: unknown }) => ({
    fetch(input: string, init?: RequestInit) {
      calls.push({ props: opts.props, url: input, init });
      const target = realExports["CachedPages"];
      if (target === undefined) {
        throw new Error("CachedPages is not exported");
      }
      return target(opts).fetch(input, init);
    },
  });
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => real.waitUntil(promise),
    passThroughOnException: () => real.passThroughOnException(),
    props: {},
    exports: options.withCachedPages === false ? {} : { CachedPages: cachedPages },
  } as unknown as ExecutionContext;
  return { ctx, calls, wait: () => waitOnExecutionContext(real) };
}

/** 開発ログイン (管理者) して Cookie と管理画面の CSRF トークンを取り出す。DO への直接 fetch。 */
export async function loginAsAdmin(
  email = "admin@example.com",
): Promise<{ cookie: string; csrfToken: string }> {
  const stub = mainGameStub();
  const loginRes = await stub.fetch("http://example.com/auth/dev", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}`,
    redirect: "manual",
  });
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) {
    throw new Error("login failed");
  }
  const adminRes = await stub.fetch("http://example.com/admin", { headers: { cookie } });
  const csrfToken = (await adminRes.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (csrfToken === undefined) {
    throw new Error("csrf token not found");
  }
  return { cookie, csrfToken };
}

/** Set-Cookie (複数) を、次のリクエストの Cookie ヘッダに使える `name=value; ...` にまとめる。 */
export function cookieHeaderFrom(response: Response, base = ""): string {
  const jar = new Map<string, string>();
  for (const part of base.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    if (index > 0) {
      jar.set(trimmed.slice(0, index), trimmed.slice(index + 1));
    }
  }
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0] ?? "";
    const index = pair.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/max-age=0/i.test(setCookie) || value === "") {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * 開発ログインして、ログインの応答の Set-Cookie をすべて (セッショントークンとセッションの
 * Cookie キャッシュ `hako.session_data`) 含む Cookie ヘッダと、CSRF トークンを返す。
 */
export async function loginWithAllCookies(
  email = "admin@example.com",
): Promise<{ cookie: string; csrfToken: string }> {
  const stub = mainGameStub();
  const loginRes = await stub.fetch("http://example.com/auth/dev", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}`,
    redirect: "manual",
  });
  const cookie = cookieHeaderFrom(loginRes);
  const adminRes = await stub.fetch("http://example.com/admin", { headers: { cookie } });
  const csrfToken = (await adminRes.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (csrfToken === undefined) {
    throw new Error("csrf token not found");
  }
  return { cookie, csrfToken };
}

/** ゲームを開始する (DO への直接 fetch)。既定 (start-at 省略) なら即座に開始扱いになる。 */
export async function startGame(cookie: string, csrfToken: string): Promise<void> {
  const stub = mainGameStub();
  const res = await stub.fetch("http://example.com/admin/games", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `_csrf=${encodeURIComponent(csrfToken)}`,
  });
  if (res.status !== 200) {
    throw new Error(`startGame failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * 島を作成する (DO への直接 fetch。ログイン中のユーザーが所有者になる)。
 * `reset()` 後の新しい "main" DO・新しいゲームに対して最初に作った島の ID は常に 1 になる。
 */
export async function createIsland(
  cookie: string,
  csrfToken: string,
  gameId: number,
  name: string,
): Promise<void> {
  const stub = mainGameStub();
  const res = await stub.fetch(`http://example.com/games/${gameId}/islands`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: `name=${encodeURIComponent(name)}&_csrf=${encodeURIComponent(csrfToken)}`,
  });
  if (res.status !== 200) {
    throw new Error(`createIsland failed: ${res.status} ${await res.text()}`);
  }
}
