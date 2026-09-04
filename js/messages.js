/**
 * messages.js
 * マスコット「かきまる」のセリフ集 ＆ メッセージプロバイダ
 */
import { getRandomItem } from './utils.js';

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

// 状況に応じたメッセージを返す関数群
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