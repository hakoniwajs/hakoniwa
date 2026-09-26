// tmp/08-turn-trigger-admin-cli.md 「Web 管理画面」節、tmp/14-users-auth.md
// 「ログイン方法の設定」節のフォームパース。v2 でパスワード欄は撤去された (セッション + isAdmin で保護)。
import { AppError } from "../../app/errors.ts";
import type { AuthMethodsFlags } from "../../app/auth-methods.ts";
import { parseLocalDateTime } from "../../app/timezone.ts";
import { field } from "./common.ts";

export interface AdminBackupForm {
  label: string | undefined;
}

export function parseAdminBackupForm(body: Record<string, string>): AdminBackupForm {
  const label = field(body, "label");
  return { label: label === "" ? undefined : label };
}

/**
 * 最終更新時刻の変更フォーム。`datetime` (datetime-local, ローカル時刻) と `unix` (秒指定) の
 * どちらか一方を受け取る。両方空なら invalid_input。
 */
export interface AdminLastTimeForm {
  unix: number;
}

export function parseAdminLastTimeForm(
  body: Record<string, string>,
  timezone: string,
): AdminLastTimeForm {
  const unixRaw = field(body, "unix");
  const datetimeRaw = field(body, "datetime");

  if (unixRaw !== "") {
    if (!/^\d+$/.test(unixRaw)) {
      throw new AppError("invalid_input", "unix must be a non-negative integer");
    }
    return { unix: Number(unixRaw) };
  }
  if (datetimeRaw !== "") {
    // datetime-local: "YYYY-MM-DDTHH:mm" (ローカル時刻扱い。タイムゾーン情報を含まない)。
    // tmp/16-season.md「タイムゾーン」節: HAKONIWA_TIMEZONE で解釈する (実行環境依存の
    // `new Date(datetimeRaw)` は使わない)。
    try {
      return { unix: parseLocalDateTime(datetimeRaw, timezone) };
    } catch {
      throw new AppError("invalid_input", "datetime must be a valid datetime-local value");
    }
  }
  throw new AppError("invalid_input", "either datetime or unix is required");
}

/**
 * 「新しいデータを作る」フォーム。開始日時 (省略可)、最終ターン数 (省略可)、
 * 1 ターンの長さ (秒、省略可。tmp/16-season.md「ターンの長さも DB に持つ」節。
 * 「時間・分」入力からの変換は `parseUnitTimeSec` を参照) を受け取る。
 */
export interface AdminInitForm {
  startAt?: number;
  finalTurn?: number | null;
  unitTimeSec?: number;
}

export function parseAdminInitForm(body: Record<string, string>, timezone: string): AdminInitForm {
  const startAtRaw = field(body, "start-at");
  const finalTurnRaw = field(body, "final-turn");
  const form: AdminInitForm = {};

  if (startAtRaw !== "") {
    try {
      form.startAt = parseLocalDateTime(startAtRaw, timezone);
    } catch {
      throw new AppError("invalid_input", "start-at must be a valid datetime-local value");
    }
  }
  if (finalTurnRaw !== "") {
    if (!/^\d+$/.test(finalTurnRaw) || Number(finalTurnRaw) <= 0) {
      throw new AppError("invalid_input", "final-turn must be a positive integer");
    }
    form.finalTurn = Number(finalTurnRaw);
  }
  const unitTimeSec = parseUnitTimeSec(body);
  if (unitTimeSec !== undefined) {
    form.unitTimeSec = unitTimeSec;
  }
  return form;
}

/**
 * 「新しいゲームを開始」フォーム。tmp/18-games.md「ルート」節: `POST /admin/games`
 * (name, start-at, final-turn, unit-hours/unit-minutes)。`name` 以外は `parseAdminInitForm` と同じ。
 */
export interface StartGameForm {
  name?: string;
  startAt?: number;
  finalTurn?: number | null;
  unitTimeSec?: number;
}

export function parseStartGameForm(body: Record<string, string>, timezone: string): StartGameForm {
  const base = parseAdminInitForm(body, timezone);
  const name = field(body, "name").trim();
  return { ...base, ...(name !== "" ? { name } : {}) };
}

/**
 * 「このゲームを終了する」フォーム。`POST /admin/games/current/finish`。tmp/18-games.md「ルート」節:
 * 誤操作防止の確認チェックボックス (`<input type="checkbox" name="confirm">`) を必須にする。
 */
export function parseFinishGameForm(body: Record<string, string>): void {
  if (field(body, "confirm") === "") {
    throw new AppError("invalid_input", "confirm checkbox is required");
  }
}

/** 「ゲーム設定」の最終ターン数変更フォーム。空欄なら無期限 (null)。 */
export function parseFinalTurnForm(body: Record<string, string>): number | null {
  const raw = field(body, "final-turn");
  if (raw === "") {
    return null;
  }
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new AppError("invalid_input", "final-turn must be a positive integer");
  }
  return Number(raw);
}

/**
 * 「時間」「分」入力 (`unit-hours` / `unit-minutes`) を秒数に変換する。
 * 「1 ターンの長さの入力を『時間・分』にする」節: 両方とも空欄なら省略扱いで `undefined`
 * を返す (「新しいデータを作る」で現在値/env の既定値を使うケース)。どちらかに値があれば
 * 非負整数・分は 0-59 で検証し、合計 (hours*3600 + minutes*60) が 60 秒未満、または
 * 不正な値なら invalid_input。
 */
function parseUnitTimeSec(body: Record<string, string>): number | undefined {
  const hoursRaw = field(body, "unit-hours");
  const minutesRaw = field(body, "unit-minutes");
  if (hoursRaw === "" && minutesRaw === "") {
    return undefined;
  }
  const hoursOk = hoursRaw === "" || /^\d+$/.test(hoursRaw);
  const minutesOk = minutesRaw === "" || /^\d+$/.test(minutesRaw);
  if (!hoursOk || !minutesOk) {
    throw new AppError("invalid_input", "unit-hours/unit-minutes must be non-negative integers");
  }
  const hours = hoursRaw === "" ? 0 : Number(hoursRaw);
  const minutes = minutesRaw === "" ? 0 : Number(minutesRaw);
  if (minutes > 59) {
    throw new AppError("invalid_input", "unit-minutes must be 0-59");
  }
  const unitTimeSec = hours * 3600 + minutes * 60;
  if (unitTimeSec < 60) {
    throw new AppError("invalid_input", "unit time must be at least 60 seconds");
  }
  return unitTimeSec;
}

/**
 * 「ゲーム設定」の 1 ターンの長さ変更フォーム (`unit-hours` / `unit-minutes`)。
 * tmp/16-season.md「ターンの長さも DB に持つ (追加要件)」節。空欄・不正値・
 * 合計 60 秒未満は invalid_input。
 */
export function parseUnitTimeForm(body: Record<string, string>): number {
  const unitTimeSec = parseUnitTimeSec(body);
  if (unitTimeSec === undefined) {
    throw new AppError("invalid_input", "unit-hours/unit-minutes is required");
  }
  return unitTimeSec;
}

/** チェックボックスの有無 (存在すれば "on" 等の非空文字列) を真偽値に変換する。 */
function parseCheckbox(body: Record<string, string>, name: string): boolean {
  return field(body, name) !== "";
}

/** 管理画面「管理者」節の追加・削除フォーム (`email`)。空欄なら invalid_input。 */
export function parseAdminEmailForm(body: Record<string, string>): string {
  const email = field(body, "email").trim();
  if (email === "") {
    throw new AppError("invalid_input", "email is required");
  }
  return email;
}

/** 管理者の初期セットアップフォーム (`/admin/setup` の `code`)。空欄なら invalid_input。 */
export function parseAdminSetupForm(body: Record<string, string>): string {
  const code = field(body, "code").trim();
  if (code === "") {
    throw new AppError("invalid_input", "code is required");
  }
  return code;
}

/** 管理画面のログイン方法トグルフォーム。 */
export function parseAuthMethodsForm(body: Record<string, string>): AuthMethodsFlags {
  return {
    x: parseCheckbox(body, "x"),
    discord: parseCheckbox(body, "discord"),
    email: parseCheckbox(body, "email"),
  };
}
