/**
 * validator.js
 * 手書き文字認識（Google Input Tools連携） ＆ 画数・正誤判定モジュール
 */

// Google Input Tools API 連携（内部ヘルパー）
async function recognizeChar(strokes) {
  const ink = strokes.map(stroke => [
    stroke.map(pt => pt[0]),
    stroke.map(pt => pt[1])
  ]);

  try {
    const res = await fetch('https://inputtools.google.com/request?ime=handwriting&app=autho&dbg=1&cs=1&oe=UTF-8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          writing_guide: { writing_area_width: 260, writing_area_height: 260 },
          pre_context: '',
          max_num_results: 5,
          language: 'ja',
          ink: ink
        }]
      })
    });
    const data = await res.json();
    return (data[1] && data[1][0] && data[1][0][1]) || [];
  } catch (err) {
    console.warn('手書き文字認識APIエラー:', err);
    return [];
  }
}

export class AnswerValidator {
  constructor(candidateLimit = 2) {
    this.candidateLimit = candidateLimit; // 第2候補まで合格判定
  }

  async validateQuestion(question, userInputs) {
    const isOkurigana = (question.type === 'okurigana');

    let validInputs = isOkurigana ? [...userInputs] : userInputs;
    if (isOkurigana) {
      while (validInputs.length > 0 && validInputs[validInputs.length - 1] === null) {
        validInputs.pop();
      }
    }

    const charResults = [];
    const adviceMessages = [];
    const questionLogDetail = { chars: [] };
    const mistakenChars = [];

    for (let i = 0; i < validInputs.length; i++) {
      const input = validInputs[i];
      const target = (i < question.targets.length) ? question.targets[i] : null;

      if (!target) {
        charResults.push(false);
        continue;
      }

      if (!input || input.strokeCount === 0) {
        charResults.push(false);
        adviceMessages.push({
          index: i,
          type: 'empty',
          msg: `${i + 1}文字目: 書かれていません`
        });
        questionLogDetail.chars.push({ target: target.char, strokes: 0, recognized: '', error: 'empty' });
        continue;
      }

      // OCR認識（Google Input Tools API連携）
      const candidates = await recognizeChar(input.strokesData);
      const recognized = candidates[0] || '';
      const isCharMatched = candidates.slice(0, this.candidateLimit).includes(target.char);

      if (!isCharMatched) {
        charResults.push(false);
        mistakenChars.push(target.char);
        adviceMessages.push({
          index: i,
          type: 'char',
          msg: `${i + 1}文字目: ちがう字を書いているかも？（認識: 「${recognized || '？'}」）`
        });
        questionLogDetail.chars.push({
          target: target.char,
          strokes: input.strokeCount,
          recognized,
          error: 'char_mismatch'
        });
        continue;
      }

      // 画数チェック
      if (input.strokeCount !== target.strokes) {
        charResults.push(false);
        mistakenChars.push(target.char);
        adviceMessages.push({
          index: i,
          type: 'stroke',
          msg: `${i + 1}文字目: 画数がちがうよ（目標: ${target.strokes}画 / 入力: ${input.strokeCount}画）`
        });
        questionLogDetail.chars.push({
          target: target.char,
          strokes: input.strokeCount,
          recognized,
          error: 'stroke_mismatch'
        });
        continue;
      }

      // 合格
      charResults.push(true);
      questionLogDetail.chars.push({
        target: target.char,
        strokes: input.strokeCount,
        recognized,
        isOk: true
      });
    }

    const isCountMatched = (validInputs.length === question.targets.length);
    const isAllCharsCorrect = charResults.every(r => r === true);
    const isAllSuccess = isCountMatched && isAllCharsCorrect;

    // 不正解時のフィードバックメッセージ生成
    let feedbackHtml = '';
    if (!isAllSuccess) {
      if (isOkurigana) {
        const firstCharError = adviceMessages.find(a => a.index === 0);
        feedbackHtml = firstCharError ? firstCharError.msg : 'おしい！ 送り仮名がちがうよ。';
      } else {
        feedbackHtml = adviceMessages.map(a => a.msg).join('<br>');
      }
    }

    return {
      isAllSuccess,
      charResults,
      validInputs,
      feedbackHtml,
      mistakenChars,
      questionLogDetail
    };
  }
}