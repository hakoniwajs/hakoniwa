// Perl 版 Main.pm/Map.pm/Turn.pm の各種メッセージ画面 (tempWrongPassword 等) の移植。
// $HtempBack (「トップへ戻る」リンク) に相当する共通コンポーネントを併せて定義する。
import type { AppErrorKind } from "../../app/errors.ts";

/**
 * Perl 版 $HtempBack。「トップへ戻る」リンク。
 * tmp/18-games.md「表示」節: 島ページ内のリンクはゲーム ID 入りにする。`gameId` を渡せる文脈
 * (観光/新規発見画面) ではそのゲームのトップへ、渡せない汎用エラー画面 (ErrorPage) では
 * `/` (現在のゲームへのリダイレクト、無ければ「ゲームはまだ開始されていません」画面) へ戻す。
 */
export function BackLink({ gameId }: { gameId?: number } = {}) {
  const href = gameId !== undefined ? `/games/${gameId}` : "/";
  return (
    <p>
      <a href={href} class="back-link">
        トップへ戻る
      </a>
    </p>
  );
}

/** 計画登録/削除、コメント更新、記帳等の結果メッセージ。Perl 版 tempCommandAdd 等。 */
export function Notice({ message }: { message: string }) {
  return (
    <div class="notice">
      <p class="big">{message}</p>
    </div>
  );
}

/** AppError.kind → 画面文言。tmp/06-web-routes-and-views.md の表 + Perl 版 temp* の文言。 */
export function errorMessage(kind: AppErrorKind): string {
  switch (kind) {
    case "island_not_found":
      return "問題発生、とりあえず戻ってください。";
    case "island_full":
      return "申し訳ありません、島が一杯で登録できません！！";
    case "no_name":
      return "島につける名前が必要です。";
    case "bad_name":
      return "',?()<>$'とか入ってたり、「無人島」とかいった変な名前はやめましょうよ〜";
    case "name_taken":
      return "その島ならすでに発見されています。";
    case "no_money":
      return "資金不足のため変更できません";
    case "lbbs_empty":
      return "名前または内容の欄が空欄です。";
    case "not_initialized":
      return "データファイルが開けません。";
    case "lbbs_disabled":
      return "問題発生、とりあえず戻ってください。";
    case "invalid_input":
      return "入力内容が不正です。";
    // login_required/forbidden/already_has_island/no_island/ng_word は認可ルール・NG ワード対応の
    // AppError.kind (tmp/14, tmp/15)。
    case "login_required":
      return "ログインが必要です。";
    case "forbidden":
      return "この操作を行う権限がありません。";
    case "already_has_island":
      return "島はひとり1つまでです。";
    case "no_island":
      return "まだ島を発見していません。";
    case "ng_word":
      return "その名前/内容は使えません。";
    // tmp/16-season.md「ターン進行」節。
    case "game_finished":
      return "ゲームは終了しました。";
    // tmp/16-season.md「開始前の状態 (追加要件)」節。
    case "game_not_started":
      return "ゲームはまだ開始していません。";
    // tmp/18-games.md「複数ゲーム」節。
    case "game_not_found":
      return "そのゲームは見つかりませんでした。";
    case "game_running":
      return "現在のゲームが終了していません。";
    // tmp/19-abandon.md「回数制限」節。
    case "abandon_limit":
      return "島の放棄は 1 ゲームにつき 3 回までです。";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** AppError.kind → HTTP ステータス。tmp/06-web-routes-and-views.md の表 + 追加分。 */
export function errorStatus(kind: AppErrorKind): 400 | 401 | 403 | 404 | 409 | 503 {
  switch (kind) {
    case "island_not_found":
      return 404;
    case "island_full":
      return 409;
    case "no_name":
    case "bad_name":
    case "name_taken":
    case "no_money":
    case "lbbs_empty":
    case "invalid_input":
    case "ng_word":
      return 400;
    case "not_initialized":
      return 503;
    case "lbbs_disabled":
      return 404;
    case "login_required":
      return 401;
    case "forbidden":
    case "no_island":
      return 403;
    // 「島はひとり1つまでです。」は 409 (island_full と同じ「もう作れない」系の意味)。
    case "already_has_island":
      return 409;
    // tmp/16-season.md「ターン進行」節。
    case "game_finished":
      return 409;
    // tmp/16-season.md「開始前の状態 (追加要件)」節。
    case "game_not_started":
      return 409;
    // tmp/18-games.md「複数ゲーム」節。
    case "game_not_found":
      return 404;
    case "game_running":
      return 409;
    // tmp/19-abandon.md「回数制限」節。
    case "abandon_limit":
      return 409;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** 想定外のエラー・AppError 共通の画面。Perl 版 tempProblem/tempWrongPassword 等。 */
export function ErrorPage({ message }: { message: string }) {
  return (
    <div class="error-page">
      <p class="big error">{message}</p>
      <BackLink />
    </div>
  );
}

/** 名前/パスワード変更完了画面。Perl 版 Turn.pm tempChange。 */
export function ChangeDonePage() {
  return (
    <div class="notice">
      <p class="big">変更完了しました</p>
      <BackLink />
    </div>
  );
}
