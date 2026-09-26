// 管理者の初期セットアップ画面 (`/admin/setup`)。管理者が 1 人もいないときだけ表示する
// (app/admin-policy.ts)。セットアップコードはサーバーのログにだけ出力し、画面には出さない。

export interface AdminSetupPageProps {
  /** ログイン中ユーザーのメールアドレス。X ログイン等でメールが無ければ undefined。 */
  email: string | undefined;
  csrfToken: string;
  /** コードが違った等のエラー表示。 */
  error?: string | undefined;
}

export function AdminSetupPage({ email, csrfToken, error }: AdminSetupPageProps) {
  return (
    <div class="admin-setup-page">
      <h1>管理者の初期設定</h1>
      <p>
        まだ管理者が設定されていません。セットアップコードを入力すると、いまログインしているアカウントが管理者になります。
      </p>
      <p>
        セットアップコードは、この画面を表示したときにサーバーのログへ出力されています (Cloudflare
        Workers ならダッシュボードの Workers のログ (Logs)、Node
        版ならサーバーを起動したコンソール)。
        ログを見られるのはサーバーの運用者だけなので、運用者以外は管理者になれません。
      </p>
      {error !== undefined ? <p class="big error">{error}</p> : ""}
      {email === undefined ? (
        <p class="big">
          管理者になるにはメールアドレスが必要です。X ログインはメールアドレスを返さないため、
          <a href="/account">アカウント設定</a>
          でメールアドレスを設定するか、Discord ログインかメールログインでログインし直してください。
        </p>
      ) : (
        <form action="/admin/setup" method="post">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <p>管理者にするメールアドレス: {email}</p>
          <p>
            セットアップコード
            <br />
            <input type="text" name="code" size={32} autocomplete="off" />
          </p>
          <input type="submit" value="管理者になる" />
        </form>
      )}
      <p>
        <small>
          環境変数 HAKONIWA_ADMIN_EMAILS に管理者のメールアドレスを設定しておくこともできます
          (その場合この画面は使いません)。
        </small>
      </p>
    </div>
  );
}
