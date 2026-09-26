// 次のターン・ゲーム開始までの残り時間を表示する補助スクリプト。
// HTML はエッジでキャッシュするため、リクエスト時刻に依存する残り時間は HTML に埋め込まず、
// `data-remaining-until` (予定時刻の unix 秒) からブラウザの現在時刻で計算して表示する。
// 表記は packages/core/src/app/format.ts の formatRemaining と同じにする
// (「あと N日 M時間 L分」。0 の単位は省略し、日数は 24 時間以上のときだけ出す。1 分未満は「まもなく」)。
// JavaScript が無効なら、予定時刻 (絶対時刻) だけが表示される。
// モジュールではない素の ES2020 として <script src="/remaining.js" defer> から読み込む。
(function () {
  "use strict";

  /** 30 秒ごとに表示を更新する。 */
  var UPDATE_INTERVAL_MS = 30000;

  function formatRemaining(diffSeconds) {
    if (diffSeconds < 60) {
      return "まもなく";
    }
    var totalMinutes = Math.floor(diffSeconds / 60);
    var totalHours = Math.floor(totalMinutes / 60);
    var days = Math.floor(totalHours / 24);
    var hours = totalHours % 24;
    var minutes = totalMinutes % 60;
    var parts = [];
    if (days > 0) {
      parts.push(days + "日");
    }
    if (hours > 0) {
      parts.push(hours + "時間");
    }
    if (minutes > 0) {
      parts.push(minutes + "分");
    }
    return "あと " + parts.join(" ");
  }

  function update() {
    var now = Math.floor(Date.now() / 1000);
    var elements = document.querySelectorAll("[data-remaining-until]");
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      var raw = element.getAttribute("data-remaining-until");
      var until = raw === null || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(until)) {
        continue;
      }
      element.textContent = " (" + formatRemaining(until - now) + ")";
    }
  }

  update();
  setInterval(update, UPDATE_INTERVAL_MS);
})();
