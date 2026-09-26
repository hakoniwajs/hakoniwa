// 管理者判定と、管理者の初期セットアップ (セットアップコード) の一元化。
//
// 管理者は次のいずれかに含まれるメールアドレスのユーザー:
// - 環境変数 `HAKONIWA_ADMIN_EMAILS` (従来どおり。管理画面からは変更できない)
// - settings 表の `admin.emails` (JSON 配列。管理画面の「管理者」節で追加・削除する)
//
// どちらも空 (管理者が 1 人もいない) のときだけ、ログイン中のユーザーが `/admin/setup` で
// セットアップコードを入力して最初の管理者になれる。セットアップコードは settings 表に保存し、
// セットアップ画面を表示するたびにサーバーのログへ出力する (web/routes/admin.tsx)。
// ログを読めるのはサーバー (Workers のログ / Node のコンソール) の運用者だけなので、
// ConsoleMailer (Resend 未設定時にマジックリンクをログに出す) と同じ信頼モデルになる。
//
// 判定はここ (AdminPolicy) にまとめ、session ミドルウェア・管理画面・トップ画面から同じ
// インスタンスを使う。
import { isAdminEmail } from "./auth.ts";
import { safeEqual } from "./constant-time.ts";
import { AppError } from "./errors.ts";
import type { SettingsRepository } from "./ports.ts";

/** settings 表のキー。値は管理者メールアドレスの JSON 配列 (小文字化済み)。 */
export const ADMIN_EMAILS_SETTINGS_KEY = "admin.emails";
/** settings 表のキー。値は初期セットアップ用のコード。 */
export const ADMIN_SETUP_CODE_SETTINGS_KEY = "admin.setupCode";

/** 紛らわしい文字 (0/O, 1/I) を除いた 32 文字。256 の約数なので 1 バイトから偏りなく選べる。 */
const SETUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 4 文字 x 5 組 = 20 文字 (約 100 ビット)。 */
const SETUP_CODE_GROUPS = 5;
const SETUP_CODE_GROUP_LENGTH = 4;

/** メールアドレスとして受け付ける最大長 (RFC 5321 の実用上限)。 */
const MAX_EMAIL_LENGTH = 254;

function generateSetupCode(): string {
  const length = SETUP_CODE_GROUPS * SETUP_CODE_GROUP_LENGTH;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % SETUP_CODE_GROUP_LENGTH === 0) {
      code += "-";
    }
    code += SETUP_CODE_ALPHABET[(bytes[i] ?? 0) % SETUP_CODE_ALPHABET.length];
  }
  return code;
}

/** 入力されたコードの正規化 (前後の空白・区切りのハイフン/空白を除き、大文字にする)。 */
function normalizeSetupCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 管理者として実際にログインし得るメールアドレス (`.invalid` のプレースホルダを除く)。 */
function effectiveEmails(emails: readonly string[]): string[] {
  return emails.filter((email) => email !== "" && !email.toLowerCase().endsWith(".invalid"));
}

function isValidEmail(email: string): boolean {
  return (
    email.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+$/.test(email) &&
    !email.endsWith(".invalid")
  );
}

function parseStoredEmails(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item !== "");
  } catch {
    return [];
  }
}

/** 管理画面の「管理者」節向け VM。 */
export interface AdminEmailsVM {
  /** `HAKONIWA_ADMIN_EMAILS` 由来 (読み取り専用)。 */
  env: string[];
  /** settings 表由来 (管理画面から追加・削除できる)。 */
  stored: string[];
}

export interface AdminPolicyDeps {
  /** `HAKONIWA_ADMIN_EMAILS`。 */
  envEmails: readonly string[];
  settings: SettingsRepository;
}

export class AdminPolicy {
  readonly #deps: AdminPolicyDeps;

  constructor(deps: AdminPolicyDeps) {
    this.#deps = deps;
  }

  /** `HAKONIWA_ADMIN_EMAILS` 由来の一覧。 */
  envEmails(): string[] {
    return [...this.#deps.envEmails];
  }

  /** settings 表由来の一覧。 */
  storedEmails(): string[] {
    return parseStoredEmails(this.#deps.settings.get(ADMIN_EMAILS_SETTINGS_KEY));
  }

  /** 環境変数 + settings 表の管理者メール一覧。 */
  adminEmails(): string[] {
    return [...this.envEmails(), ...this.storedEmails()];
  }

  /** email が管理者か (大文字小文字を無視。`.invalid` のプレースホルダは常に false)。 */
  isAdmin(email: string): boolean {
    return isAdminEmail(email, this.adminEmails());
  }

  /** 管理者が 1 人もいない (初期セットアップが必要) か。 */
  needsSetup(): boolean {
    return effectiveEmails(this.adminEmails()).length === 0;
  }

  emails(): AdminEmailsVM {
    return { env: this.envEmails(), stored: this.storedEmails() };
  }

  /**
   * 初期セットアップ用のコード。まだ無ければ生成して保存する。
   * 呼び出し側 (web/routes/admin.tsx) がこれをサーバーのログに出力する。
   */
  setupCode(): string {
    const stored = this.#deps.settings.get(ADMIN_SETUP_CODE_SETTINGS_KEY);
    if (stored !== undefined && stored !== "") {
      return stored;
    }
    const code = generateSetupCode();
    this.#deps.settings.set(ADMIN_SETUP_CODE_SETTINGS_KEY, code);
    return code;
  }

  /**
   * セットアップコードを検証し、`email` を最初の管理者として settings 表に登録する。
   * - 既に管理者がいれば forbidden (セットアップは 1 度きり)。
   * - メールアドレスが無い (X ログインのプレースホルダ) ユーザーは invalid_input。
   * - コードが違えば forbidden。
   * 成功したらコードを作り直し、使ったコードを再利用できないようにする。
   */
  claimWithSetupCode(email: string, code: string): void {
    if (!this.needsSetup()) {
      throw new AppError("forbidden", "admin already exists");
    }
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      throw new AppError("invalid_input", "email address is required");
    }
    const expected = normalizeSetupCode(this.setupCode());
    if (!safeEqual(normalizeSetupCode(code), expected)) {
      throw new AppError("forbidden", "invalid setup code");
    }
    this.#saveStored([normalizedEmail]);
    this.#deps.settings.set(ADMIN_SETUP_CODE_SETTINGS_KEY, generateSetupCode());
  }

  /** settings 表の一覧にメールアドレスを追加する。 */
  addEmail(raw: string): void {
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) {
      throw new AppError("invalid_input", "invalid email address");
    }
    const stored = this.storedEmails();
    if (stored.some((candidate) => candidate.toLowerCase() === email)) {
      return;
    }
    this.#saveStored([...stored, email]);
  }

  /**
   * settings 表の一覧からメールアドレスを削除する。環境変数由来のものは削除できない
   * (settings 表に無いので何も起きない)。削除すると管理者が 1 人もいなくなる場合は
   * invalid_input で拒否する (全員が締め出されるのを防ぐ)。
   */
  removeEmail(raw: string): void {
    const email = normalizeEmail(raw);
    const stored = this.storedEmails();
    const remaining = stored.filter((candidate) => candidate.toLowerCase() !== email);
    if (remaining.length === stored.length) {
      return;
    }
    if (effectiveEmails([...this.envEmails(), ...remaining]).length === 0) {
      throw new AppError("invalid_input", "cannot remove the last admin");
    }
    this.#saveStored(remaining);
  }

  #saveStored(emails: readonly string[]): void {
    this.#deps.settings.set(ADMIN_EMAILS_SETTINGS_KEY, JSON.stringify(emails));
  }
}
