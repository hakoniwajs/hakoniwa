// サイト設定 (サイトタイトル・フッタ情報・追加 NG ワード・ローカル掲示板・タイムゾーン)。
// 以前は環境変数 (HAKONIWA_SITE_TITLE 等) から起動時に読み込む静的な設定だったが、
// セットアップを簡単にするため管理画面 (`/admin` の「サイト設定」) から変更できるようにし、
// settings 表に保存する。値の優先順位は「settings 表 > 環境変数 (非推奨) > コードの既定値」で、
// settings 表の値の解決はここ (SiteSettingsService) にまとめる。auth-methods.ts と同じく
// settings 表の値は JSON で持つ。
import type { SettingsRepository } from "./ports.ts";

/** ヘッダ・フッタに表示するサイト情報。views/layout.tsx が使う。 */
export interface SiteInfo {
  /** サイトタイトル (ヘッダ・`<title>`・OGP タイトル)。 */
  title: string;
  /** フッタの管理者名。空文字列なら表示しない。 */
  adminName: string;
  /** フッタの管理者の連絡先メールアドレス。空文字列なら表示しない。 */
  email: string;
  /** フッタの掲示板 URL。空文字列なら表示しない。 */
  bbsUrl: string;
  /** フッタのトップページ URL。空文字列なら表示しない。 */
  topPageUrl: string;
}

export interface SiteSettings extends SiteInfo {
  /** 同梱リストに加えて拒否する追加の NG ワード (部分一致)。 */
  ngWords: string[];
  /** 島ごとのローカル掲示板を使うか。 */
  useLbbs: boolean;
  /** datetime-local の解釈と画面の日時表示に使う IANA タイムゾーン名。tmp/16-season.md「タイムゾーン」節。 */
  timezone: string;
}

/**
 * 画面の描画に必要なサイト設定 (追加 NG ワードを除く)。KV スナップショット
 * (packages/cloudflare) で Worker 側レンダリングに渡す形でもある。
 */
export type SiteRenderSettings = Omit<SiteSettings, "ngWords">;

/** コードの既定値。adminName/email/bbsUrl/topPageUrl は空 (フッタの該当行を出さない)。 */
export const defaultSiteSettings: SiteSettings = {
  title: "箱庭諸島２",
  adminName: "",
  email: "",
  bbsUrl: "",
  topPageUrl: "",
  ngWords: [],
  useLbbs: false,
  timezone: "Asia/Tokyo",
};

/** settings 表のキー。値は `SiteSettings` の JSON。 */
export const SITE_SETTINGS_KEY = "site.settings";

/** 入力値の上限。管理画面のフォーム (web/forms/admin-forms.ts) の検証と `maxlength` に使う。 */
export const SITE_SETTINGS_LIMITS = {
  title: 64,
  adminName: 64,
  email: 254,
  url: 512,
  ngWord: 64,
  ngWordsCount: 200,
  timezone: 64,
} as const;

/** `Intl.DateTimeFormat` が受け付ける IANA タイムゾーン名か。 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * NG ワードの入力 (改行区切り・カンマ区切りのどちらでもよい) を配列にする。
 * 前後の空白を除き、空要素と重複は捨てる。
 */
export function parseNgWordsText(raw: string): string[] {
  const words = raw
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set(words)];
}

function parseStoredSiteSettings(raw: string | undefined): Partial<SiteSettings> {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const result: Partial<SiteSettings> = {};
  for (const key of ["title", "adminName", "email", "bbsUrl", "topPageUrl"] as const) {
    const value = record[key];
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  // タイトルが空だとヘッダが消えてしまうので、空文字列は「未設定」扱いにする。
  if (result.title === "") {
    delete result.title;
  }
  if (Array.isArray(record.ngWords)) {
    result.ngWords = record.ngWords.filter((w): w is string => typeof w === "string");
  }
  if (typeof record.useLbbs === "boolean") {
    result.useLbbs = record.useLbbs;
  }
  // 保存後に実行環境のタイムゾーンデータが変わった等で不正になっていたら無視する。
  if (typeof record.timezone === "string" && isValidTimeZone(record.timezone)) {
    result.timezone = record.timezone;
  }
  return result;
}

/** 現在のサイト設定を読む口。GameService や web 層はこれだけに依存する。 */
export interface SiteSettingsReader {
  get(): SiteSettings;
}

export interface SiteSettingsServiceDeps {
  settings: SettingsRepository;
  /**
   * settings 表に値が無い項目に使う値。環境変数 (非推奨。`loadConfigFromEnv` の
   * `AppConfig.siteDefaults`) があればそれ、無ければ `defaultSiteSettings`。
   */
  fallback: SiteSettings;
}

/**
 * サイト設定の読み書き。settings 表に保存された値 > `fallback` (環境変数 > 既定値) の順で
 * 項目ごとに解決する。値は実行中に管理画面から変わるため、利用側はキャッシュせず
 * リクエストごとに `get()` を呼ぶ。
 */
export class SiteSettingsService implements SiteSettingsReader {
  readonly #deps: SiteSettingsServiceDeps;

  constructor(deps: SiteSettingsServiceDeps) {
    this.#deps = deps;
  }

  get(): SiteSettings {
    const stored = parseStoredSiteSettings(this.#deps.settings.get(SITE_SETTINGS_KEY));
    const fallback = this.#deps.fallback;
    return {
      ...fallback,
      ...stored,
      ngWords: [...(stored.ngWords ?? fallback.ngWords)],
    };
  }

  /** 管理画面からの保存。検証は呼び出し側 (web/forms/admin-forms.ts) で済ませておく。 */
  update(next: SiteSettings): void {
    const value: SiteSettings = {
      title: next.title,
      adminName: next.adminName,
      email: next.email,
      bbsUrl: next.bbsUrl,
      topPageUrl: next.topPageUrl,
      ngWords: [...next.ngWords],
      useLbbs: next.useLbbs,
      timezone: next.timezone,
    };
    this.#deps.settings.set(SITE_SETTINGS_KEY, JSON.stringify(value));
  }
}

/** 描画用のサイト設定 (`SiteRenderSettings`) を取り出す。追加 NG ワードは含めない。 */
export function toSiteRenderSettings(settings: SiteSettings): SiteRenderSettings {
  return {
    title: settings.title,
    adminName: settings.adminName,
    email: settings.email,
    bbsUrl: settings.bbsUrl,
    topPageUrl: settings.topPageUrl,
    useLbbs: settings.useLbbs,
    timezone: settings.timezone,
  };
}
