// Vite の `?raw` インポート (ファイルの中身を文字列として読み込む) の型。テストで
// public/ 配下のブラウザ向けスクリプトを読み込むのに使う。
declare module "*?raw" {
  const content: string;
  export default content;
}
