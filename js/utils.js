/**
 * utils.js
 * 汎用ユーティリティモジュール
 */

// 配列からランダムに1件取得
export function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Fisher-Yates アルゴリズムによる完全ランダムシャッフル
export function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
}