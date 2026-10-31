// `auth.api.*` は baseURL 未設定だとリクエストから推定しない (HTTP の auth.handler だけが推定する)。
// 呼び出し元の Request を渡し、bootstrap/auth.ts の hooks.before が
// `new URL(request.url).origin` をその呼び出しの baseURL にする。
// Request を渡すと better-auth は既定で Response を返すため、`asResponse: false` を付ける。
import type { Context } from "hono";
import type { AppEnv } from "./env.ts";

export function betterAuthServerCall(c: Context<AppEnv>): {
  headers: Headers;
  request: Request;
  asResponse: false;
} {
  return {
    headers: c.req.raw.headers,
    request: c.req.raw,
    asResponse: false,
  };
}
