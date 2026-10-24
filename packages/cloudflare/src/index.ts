// @hakoniwajs/cloudflare の公開 API。
// 利用側は `export default createWorker()` + `export { CachedPages, HakoniwaGame }` で Worker を構成する。
export { HakoniwaGame } from "./game-object.ts";
export type { Env } from "./env.ts";
export type { CreateWorkerOptions, HakoniwaWorker } from "./worker.ts";
export { createWorker } from "./worker.ts";
export type { CreateCachedPagesOptions } from "./cached-pages.ts";
export { CachedPages, createCachedPages } from "./cached-pages.ts";
export type { CachedPagesProps } from "./cache-policy.ts";
