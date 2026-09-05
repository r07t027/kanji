/**
 * messages.js
 * アプリ定数・小型ユーティリティ・かきまるセリフ集
 */

// ==================== 定数定義 ====================
export const KAKIMARU_IMAGES = {
  info: [
    'assets/images/kakimaru_01.png',
    'assets/images/kakimaru_02.png'
  ],
  success: [
    'assets/images/kakimaru_03.png',
    'assets/images/kakimaru_04.png',
    'assets/images/kakimaru_05.png'
  ],
  mistake: [
    'assets/images/kakimaru_06.png',
    'assets/images/kakimaru_07.png',
    'assets/images/kakimaru_08.png'
  ],
  clear: 'assets/images/kakimaru_09.png'
};

export const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// ==================== 小型ユーティリティ ====================
export function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

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

// ==================== かきまるセリフ集 ====================
export const KAKIMARU_MESSAGES = {
  inputAdvices: [
    (num) => `${num}もじめを かいてね！１かく１かく ていねいに かこう。`,
    (num) => `${num}もじめを かいてね！マスの まんなかに おさめよう。`,
    (num) => `${num}もじめを かいてね！もくひょうの かくすう ぴったりを めざそう。`,
    (num) => `${num}もじめを かいてね！ゆっくり バランスよく かこう。`,
    (num) => `${num}もじめを かいてね！とめ・はね を いしき してみよう。`
  ],
  okuriganaAdvices: [
    (num) => `${num}もじめの おくりがなを ひらがなで かいてね。`,
    (num) => `かきおわったら「こたえあわせ」を おしてね。`,
    (num) => `おくりがなは ここまでかな？よく たしかめてみよう。`,
    (num) => `ただしく かけたら「こたえあわせ」を おそう。`,
    (num) => `おくりがなの もじすうに きをつけてね。`
  ],
  retryAdvices: [
    'かきなおして さいチャレンジ！おちついて かこう。',
    'だいじょうぶ！かたちを よく おもいだしてみてね。',
    'おてほんの かたちを イメージして かいてみよう。'
  ],
  praise: [
    'すごい！大せいかい。',
    'ばっちり！そのちょうし。',
    'きれいな じで かけたね。',
    'さすが！かっこいい じだよ。'
  ],
  mistake: [
    'おしい！おてほんを みなおしてみてね。',
    'もうひといき！かくすうを たしかめてみよう。',
    'だいじょうぶ、つぎは きっと かけるよ。'
  ]
};

export function getInputAdvice(charNum, isOkurigana = false) {
  if (isOkurigana && charNum > 1) {
    const fn = getRandomItem(KAKIMARU_MESSAGES.okuriganaAdvices);
    return fn(charNum);
  }
  const fn = getRandomItem(KAKIMARU_MESSAGES.inputAdvices);
  return fn(charNum);
}

export function getRetryAdvice() {
  return getRandomItem(KAKIMARU_MESSAGES.retryAdvices);
}

export function getPraiseMessage() {
  return getRandomItem(KAKIMARU_MESSAGES.praise);
}

export function getMistakeMessage() {
  return getRandomItem(KAKIMARU_MESSAGES.mistake);
}