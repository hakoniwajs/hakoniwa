// 秘密値 (CSRF トークン、管理者セットアップコード) の比較に使う定数時間文字列比較。
// bootstrap/csrf.ts と app/admin-policy.ts から共通で使う。

/**
 * 定数時間文字列比較 (自前の XOR 累積比較)。
 * 長さが異なっても最後まで比較を続け、早期リターンで長さの違いが漏れないようにする。
 */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
