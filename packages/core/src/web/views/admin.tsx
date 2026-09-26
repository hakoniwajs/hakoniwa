// Perl 版 Maintenance.pm (hako-mente.cgi) mainMode/dataPrint の移植。
// tmp/14-users-auth.md によりパスワード欄を撤去し (`_csrf` で保護)、
// ログイン方法のトグルと資金・食料最大化フォームを追加した。
import type { AdminEmailsVM } from "../../app/admin-policy.ts";
import type { AdminStatus, AuthMethodsVM } from "../../app/admin-service.ts";
import { formatDuration, formatTurnLabel, GAME_NOT_STARTED_LABEL } from "../../app/format.ts";
import type { BackupInfo } from "../../app/ports.ts";
import type { SeasonState } from "../../app/season.ts";
import { formatDateTime, formatDateTimeLocalValue } from "../../app/timezone.ts";
import type { IslandSelectVM } from "../../app/view-models.ts";
import { GamesTable } from "./games.tsx";

/** unix 秒 → ローカル日時文字列。Perl 版 timeToString。 */
function timeToString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("ja-JP");
}

/** 秒数を「時間・分」の 2 つの数値入力の既定値に分解する。 */
function splitHoursMinutes(totalSeconds: number): { hours: number; minutes: number } {
  const totalMinutes = Math.floor(totalSeconds / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** SeasonState → 表示文言。tmp/16-season.md「管理画面」節。 */
function seasonStateLabel(state: SeasonState): string {
  switch (state) {
    case "before":
      return GAME_NOT_STARTED_LABEL;
    case "running":
      return "進行中";
    case "finished":
      return "終了";
  }
}

function BackupRow({ backup, csrfToken }: { backup: BackupInfo; csrfToken: string }) {
  return (
    <div class="backup-row">
      <h3>バックアップ: {backup.label}</h3>
      <p>
        <b>{formatTurnLabel(backup.turn)}</b>
      </p>
      <p>
        <b>作成時刻</b>:{timeToString(backup.createdAt)}
        (1970年1月1日から{backup.createdAt}秒)
      </p>
      <form action={`/admin/backups/${backup.label}/restore`} method="post">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="submit" value="このデータを現役に" />
      </form>
      <form action={`/admin/backups/${backup.label}/delete`} method="post">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="submit" value="このデータを削除" />
      </form>
    </div>
  );
}

/** ログイン方法 (X/Discord/メール) の ON/OFF トグル。tmp/14-users-auth.md 「ログイン方法の設定」節。 */
function AuthMethodsForm({
  authMethods,
  csrfToken,
}: {
  authMethods: AuthMethodsVM;
  csrfToken: string;
}) {
  return (
    <form action="/admin/auth-methods" method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <div class="table-scroll">
        <table border={1}>
          <tr>
            <th>ログイン方法</th>
            <th>設定状況</th>
            <th>有効</th>
          </tr>
          <tr>
            <td>X (Twitter)</td>
            <td>{authMethods.configured.x ? "設定済み" : "未設定"}</td>
            <td>
              <input
                type="checkbox"
                name="x"
                checked={authMethods.enabled.x}
                disabled={!authMethods.configured.x}
              />
            </td>
          </tr>
          <tr>
            <td>Discord</td>
            <td>{authMethods.configured.discord ? "設定済み" : "未設定"}</td>
            <td>
              <input
                type="checkbox"
                name="discord"
                checked={authMethods.enabled.discord}
                disabled={!authMethods.configured.discord}
              />
            </td>
          </tr>
          <tr>
            <td>メール{authMethods.mailerIsConsole ? "(開発用: ログ出力のみ)" : ""}</td>
            <td>{authMethods.configured.email ? "設定済み" : "未設定"}</td>
            <td>
              <input
                type="checkbox"
                name="email"
                checked={authMethods.enabled.email}
                disabled={!authMethods.configured.email}
              />
            </td>
          </tr>
        </table>
      </div>
      <input type="submit" value="ログイン方法の設定を保存" />
    </form>
  );
}

/**
 * 管理者の一覧と追加・削除 (app/admin-policy.ts)。HAKONIWA_ADMIN_EMAILS 由来は読み取り専用。
 * 管理画面で追加した分は settings 表に保存する。
 */
function AdminEmailsSection({
  adminEmails,
  csrfToken,
}: {
  adminEmails: AdminEmailsVM;
  csrfToken: string;
}) {
  return (
    <>
      <div class="table-scroll">
        <table border={1}>
          <tr>
            <th>メールアドレス</th>
            <th>設定元</th>
            <th></th>
          </tr>
          {adminEmails.env.map((email) => (
            <tr key={`env-${email}`}>
              <td>{email}</td>
              <td>環境変数 (HAKONIWA_ADMIN_EMAILS)</td>
              <td>-</td>
            </tr>
          ))}
          {adminEmails.stored.map((email) => (
            <tr key={`stored-${email}`}>
              <td>{email}</td>
              <td>管理画面</td>
              <td>
                <form action="/admin/admins/delete" method="post">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="email" value={email} />
                  <input type="submit" value="削除" />
                </form>
              </td>
            </tr>
          ))}
        </table>
      </div>
      <form action="/admin/admins" method="post">
        <input type="hidden" name="_csrf" value={csrfToken} />
        メールアドレス
        <input type="email" name="email" size={32} />
        <input type="submit" value="管理者を追加" />
      </form>
      <p>
        <small>
          X ログインはメールアドレスを返さないため、管理者にするアカウントは Discord
          ログインかメールログインのアドレス (またはアカウント設定で設定したメールアドレス)
          を指定してください。環境変数で指定した管理者はここからは削除できません。最後の 1
          人の管理者は削除できません。
        </small>
      </p>
    </>
  );
}

/** 資金・食料の最大化。tmp/14-users-auth.md 「決定事項」6 (特殊パスワードの代わり)。 */
function MaximizeForm({
  islands,
  csrfToken,
}: {
  islands: readonly IslandSelectVM[];
  csrfToken: string;
}) {
  if (islands.length === 0) {
    return <></>;
  }
  return (
    <form action="/admin/maximize" method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <select name="id">
        {islands.map((island) => (
          <option value={island.id} key={island.id}>
            {island.name}島
          </option>
        ))}
      </select>
      <input type="submit" value="資金・食料を最大にする" />
    </form>
  );
}

export interface AdminPageProps {
  status: AdminStatus;
  authMethods: AuthMethodsVM;
  /** 管理者の一覧 (環境変数由来 + 管理画面で追加した分)。 */
  adminEmails: AdminEmailsVM;
  islands: readonly IslandSelectVM[];
  /** datetime-local の解釈・表示に使うタイムゾーン。tmp/16-season.md「タイムゾーン」節。 */
  timezone: string;
  /**
   * 「新しいデータを作る」フォームの既定値
   * (HAKONIWA_START_AT / HAKONIWA_FINAL_TURN / HAKONIWA_UNIT_TIME_SEC 由来)。
   */
  initDefaults: { startAt?: number; finalTurn?: number; unitTimeSec: number };
  csrfToken: string;
  notice: string | undefined;
}

/**
 * 「新しいゲームを開始」フォーム。tmp/18-games.md「ルート」節: `POST /admin/games`。
 * 名前 (省略時「第 N 回」)・開始日時 (省略可)・最終ターン数 (省略可)・1 ターンの長さ (秒) を入力する。
 * 現在のゲームが無いか finished のときだけ表示する (呼び出し側で判定)。
 */
function StartGameForm({
  timezone,
  initDefaults,
  csrfToken,
}: {
  timezone: string;
  initDefaults: { startAt?: number; finalTurn?: number; unitTimeSec: number };
  csrfToken: string;
}) {
  return (
    <form action="/admin/games" method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <p>
        ゲーム名 (省略時:「第 N 回」)
        <br />
        <input type="text" name="name" size={32} maxlength={32} />
      </p>
      <p>
        開始日時 (省略時: 現在時刻を切り下げ。{timezone})
        <br />
        <input
          type="datetime-local"
          name="start-at"
          value={
            initDefaults.startAt !== undefined
              ? formatDateTimeLocalValue(initDefaults.startAt, timezone)
              : ""
          }
        />
      </p>
      <p>
        最終ターン数 (省略時: 無期限)
        <br />
        <input type="number" name="final-turn" min={1} value={initDefaults.finalTurn ?? ""} />
      </p>
      <p>
        1 ターンの長さ
        <br />
        <input
          type="number"
          name="unit-hours"
          min={0}
          value={splitHoursMinutes(initDefaults.unitTimeSec).hours}
        />
        時間
        <input
          type="number"
          name="unit-minutes"
          min={0}
          max={59}
          value={splitHoursMinutes(initDefaults.unitTimeSec).minutes}
        />
        分
      </p>
      <input type="submit" value="新しいゲームを開始" />
    </form>
  );
}

/**
 * 「このゲームを終了する」フォーム。tmp/18-games.md「ルート」節: `POST /admin/games/current/finish`。
 * running のときのみ表示する (呼び出し側で判定)。誤操作防止のため確認チェックボックスを必須にする。
 */
function FinishGameForm({ csrfToken }: { csrfToken: string }) {
  return (
    <form action="/admin/games/current/finish" method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <label>
        <input type="checkbox" name="confirm" />
        このゲームを終了してよろしいですか？ (過去のゲームとして読み取り専用で残ります)
      </label>
      <br />
      <input type="submit" value="このゲームを終了する" />
    </form>
  );
}

export function AdminPage({
  status,
  authMethods,
  adminEmails,
  islands,
  timezone,
  initDefaults,
  csrfToken,
  notice,
}: AdminPageProps) {
  return (
    <div class="admin-page">
      <h1>箱島２ メンテナンスツール</h1>
      {notice !== undefined ? <p class="notice big">{notice}</p> : ""}

      {status.initialized && status.season !== undefined ? (
        <div class="current-data">
          <h2>現役データ</h2>
          <p>
            <b>ゲーム名</b>:{status.gameName}
          </p>
          <p>
            <b>ID</b>:{status.gameId}
          </p>
          <p>
            <b>{status.turn !== undefined ? formatTurnLabel(status.turn) : ""}</b>
          </p>
          <p>
            <b>最終更新時間</b>:{status.lastTime !== undefined ? timeToString(status.lastTime) : ""}
          </p>
          <p>
            <b>最終更新時間(秒数表示)</b>:1970年1月1日から{status.lastTime}秒
          </p>
          <p>
            <b>開始時刻</b>:{formatDateTime(status.season.startAt, timezone)}({timezone})
          </p>
          <p>
            <small>最終ターン:{status.season.finalTurn ?? "無期限"}</small>
          </p>
          <p>
            <small>1 ターンの長さ:{formatDuration(status.season.unitTimeSec)}</small>
          </p>
          <p>
            <small>状態:{seasonStateLabel(status.season.state)}</small>
          </p>
          <form action="/admin/reset" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="submit" value="このデータを削除" />
          </form>

          <h3>最終更新時間の変更</h3>
          <form action="/admin/last-time" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="datetime-local" name="datetime" />
            <input type="submit" value="変更" />
          </form>
          <form action="/admin/last-time" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            1970年1月1日から
            <input type="text" size={32} name="unix" />秒
            <input type="submit" value="秒指定で変更" />
          </form>

          <h3>ターン進行</h3>
          <form action="/admin/turn" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="submit" value="ターンを進める" />
          </form>

          <h3>ゲーム設定</h3>
          <form action="/admin/final-turn" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            最終ターン数 (空欄で無期限)
            <input type="number" name="final-turn" min={1} value={status.season.finalTurn ?? ""} />
            <input type="submit" value="最終ターン数を変更" />
          </form>
          <form action="/admin/unit-time" method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />1 ターンの長さ
            (変更は次のターン境界から効く)
            <input
              type="number"
              name="unit-hours"
              min={0}
              value={splitHoursMinutes(status.season.unitTimeSec).hours}
            />
            時間
            <input
              type="number"
              name="unit-minutes"
              min={0}
              max={59}
              value={splitHoursMinutes(status.season.unitTimeSec).minutes}
            />
            分
            <input type="submit" value="1 ターンの長さを変更" />
          </form>

          <h3>資金・食料の最大化</h3>
          <MaximizeForm islands={islands} csrfToken={csrfToken} />

          {/* tmp/18-games.md「ルート」節: 現在のゲームが無いか finished のときだけ表示する。 */}
          <h3>新しいゲームを開始</h3>
          {status.gameStatus === "finished" ? (
            <StartGameForm timezone={timezone} initDefaults={initDefaults} csrfToken={csrfToken} />
          ) : (
            <p>現在のゲームが終了していません。</p>
          )}

          <h3>このゲームを終了する</h3>
          {status.gameStatus === "running" ? (
            <FinishGameForm csrfToken={csrfToken} />
          ) : (
            <p>このゲームは既に終了しています。</p>
          )}
        </div>
      ) : (
        <div class="current-data">
          <h2>現役データ</h2>
          <p>まだゲームがありません。</p>
          <h3>新しいゲームを開始</h3>
          <StartGameForm timezone={timezone} initDefaults={initDefaults} csrfToken={csrfToken} />
        </div>
      )}

      <hr />
      <h2>ゲーム一覧</h2>
      <GamesTable games={status.games} currentGameId={status.gameId} timezone={timezone} />

      <hr />
      <h2>ログイン方法</h2>
      <AuthMethodsForm authMethods={authMethods} csrfToken={csrfToken} />

      <hr />
      <h2>管理者</h2>
      <AdminEmailsSection adminEmails={adminEmails} csrfToken={csrfToken} />

      <hr />
      <h2>バックアップ一覧</h2>
      <form action="/admin/backups" method="post">
        <input type="hidden" name="_csrf" value={csrfToken} />
        ラベル(省略可)
        <input type="text" name="label" size={32} />
        <input type="submit" value="バックアップを作成" />
      </form>
      {status.backups.map((backup) => (
        <BackupRow backup={backup} csrfToken={csrfToken} key={backup.label} />
      ))}
    </div>
  );
}
