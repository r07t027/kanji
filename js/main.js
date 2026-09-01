// アプリケーション統合・エントリーポイント
import { initAudioUnlock, playCorrectSound, playFanfareSound, playMistakeSound } from './audio.js';
import { CanvasController } from './canvas.js';
import { recognizeChar } from './recognition.js';
import { UIController } from './ui.js';
import { sendLog } from './logger.js';

class KanjiApp {
  constructor() {
    this.questions = [];
    this.currentQIndex = 0;
    this.currentCharIndex = 0;
    this.userInputs = [];

    this.ui = new UIController();
    this.canvasController = new CanvasController(
      document.getElementById('draw-canvas'),
      (strokeCount, strokesData) => this.onStrokeEnd(strokeCount, strokesData)
    );

    this.init();
  }

  async init() {
    initAudioUnlock();
    this.bindEvents();

    try {
      const res = await fetch('data/questions.json');
      this.questions = await res.json();
      this.loadQuestion(0);
    } catch (e) {
      console.error('問題データの読み込みに失敗しました:', e);
      this.ui.setMessage('問題データの読み込みに失敗しました', 'mistake');
    }
  }

  bindEvents() {
    document.getElementById('btn-reset').addEventListener('click', () => this.handleReset());
    document.getElementById('btn-restart-all').addEventListener('click', () => this.handleRestartAll());
    document.getElementById('btn-prev').addEventListener('click', () => this.handlePrev());
    document.getElementById('btn-next').addEventListener('click', () => this.handleNext());
    document.getElementById('btn-check').addEventListener('click', () => this.handleCheck());
  }

  getCurrentQuestion() {
    return this.questions[this.currentQIndex];
  }

  loadQuestion(qIndex) {
    this.currentQIndex = qIndex;
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');

    this.ui.updateQuestionHeader(qIndex, this.questions.length, q.sentenceHtml, q.notice);

    if (isOkurigana) {
      this.userInputs = [null];
    } else {
      this.userInputs = new Array(q.targets.length).fill(null);
    }

    this.loadCharInput(0);
  }

  loadCharInput(cIndex) {
    this.currentCharIndex = cIndex;
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');

    const targetStroke = (cIndex < q.targets.length) ? q.targets[cIndex].strokes : 0;

    this.ui.renderTabs(
      this.userInputs.length,
      cIndex,
      this.userInputs,
      (index) => {
        this.saveCurrentDrawing();
        this.loadCharInput(index);
      },
      isOkurigana
    );

    if (this.userInputs[cIndex]) {
      this.canvasController.loadStrokes(
        this.userInputs[cIndex].strokesData,
        this.userInputs[cIndex].strokeCount
      );
    } else {
      this.canvasController.clear();
    }

    const currentCount = this.canvasController.strokeCount;
    this.ui.updateStrokeInfo(currentCount, targetStroke, isOkurigana, cIndex);
    this.ui.updateNavButtons(cIndex, this.userInputs.length, isOkurigana, q.maxChars);
    this.checkButtonState();

    this.ui.setMessage(`${cIndex + 1}文字目を書いてね`);
  }

  saveCurrentDrawing() {
    const data = this.canvasController.getData();
    if (data.strokeCount > 0) {
      this.userInputs[this.currentCharIndex] = data;
    } else {
      this.userInputs[this.currentCharIndex] = null;
    }
  }

  onStrokeEnd(strokeCount, strokesData) {
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (this.currentCharIndex < q.targets.length) ? q.targets[this.currentCharIndex].strokes : 0;

    this.ui.updateStrokeInfo(strokeCount, targetStroke, isOkurigana, this.currentCharIndex);
    this.saveCurrentDrawing();
    this.ui.renderTabs(
      this.userInputs.length,
      this.currentCharIndex,
      this.userInputs,
      (index) => {
        this.saveCurrentDrawing();
        this.loadCharInput(index);
      },
      isOkurigana
    );
    this.checkButtonState();
  }

  checkButtonState() {
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');
    const currentFilled = this.canvasController.strokeCount > 0;

    if (isOkurigana) {
      const anyFilled = this.userInputs.some((input, idx) => {
        if (idx === this.currentCharIndex) return currentFilled;
        return input !== null && input.strokeCount > 0;
      });
      this.ui.updateCheckButtonState(anyFilled);
    } else {
      const allFilled = this.userInputs.every((input, idx) => {
        if (idx === this.currentCharIndex) return currentFilled;
        return input !== null && input.strokeCount > 0;
      });
      this.ui.updateCheckButtonState(allFilled);
    }
  }

  handleReset() {
    this.canvasController.clear();
    this.userInputs[this.currentCharIndex] = null;
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (this.currentCharIndex < q.targets.length) ? q.targets[this.currentCharIndex].strokes : 0;

    this.ui.updateStrokeInfo(0, targetStroke, isOkurigana, this.currentCharIndex);
    this.ui.renderTabs(
      this.userInputs.length,
      this.currentCharIndex,
      this.userInputs,
      (index) => {
        this.saveCurrentDrawing();
        this.loadCharInput(index);
      },
      isOkurigana
    );
    this.checkButtonState();
    this.ui.setMessage('書き直してみてね');
  }

  handleRestartAll() {
    this.loadQuestion(this.currentQIndex);
    this.ui.setMessage('1文字目からもう一度書いてみよう！');
  }

  handlePrev() {
    this.saveCurrentDrawing();
    this.loadCharInput(this.currentCharIndex - 1);
  }

  handleNext() {
    if (this.canvasController.strokeCount === 0) {
      this.ui.setMessage('文字を書いてから次へ進んでね！', 'mistake');
      return;
    }
    this.saveCurrentDrawing();

    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');

    if (isOkurigana) {
      if (this.currentCharIndex === this.userInputs.length - 1 && this.userInputs.length < q.maxChars) {
        this.userInputs.push(null);
      }
      this.loadCharInput(this.currentCharIndex + 1);
    } else {
      this.loadCharInput(this.currentCharIndex + 1);
    }
  }

  async handleCheck() {
    this.saveCurrentDrawing();
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');
    this.ui.updateCheckButtonState(false);
    this.ui.setMessage('判定中...✍️');

    try {
      let validInputs = isOkurigana ? [...this.userInputs] : this.userInputs;
      if (isOkurigana) {
        while (validInputs.length > 0 && validInputs[validInputs.length - 1] === null) {
          validInputs.pop();
        }
      }

      const charResults = [];
      const adviceMessages = [];

      for (let i = 0; i < validInputs.length; i++) {
        const input = validInputs[i];
        const target = (i < q.targets.length) ? q.targets[i] : null;

        if (!target) {
          charResults.push(false);
          continue;
        }

        if (!input || input.strokeCount === 0) {
          charResults.push(false);
          adviceMessages.push(`${i + 1}文字目: 書かれていません`);
          continue;
        }

        // 1. OCR認識チェック（誤字判定を最優先）
        const candidates = await recognizeChar(input.strokesData);
        const isCharMatched = candidates.slice(0, 4).includes(target.char);

        if (!isCharMatched) {
          charResults.push(false);
          adviceMessages.push(`${i + 1}文字目: ちがう字を書いているかも？（認識: 「${candidates[0] || '？'}」）`);
          continue;
        }

        // 2. 画数チェック（字形が合っている場合の画数不一致）
        if (input.strokeCount !== target.strokes) {
          charResults.push(false);
          adviceMessages.push(`${i + 1}文字目: 画数がちがうよ（目標: ${target.strokes}画 / 入力: ${input.strokeCount}画）`);
          continue;
        }

        // OCRも画数も両方一致で正解(◯)
        charResults.push(true);
      }

      const isCountMatched = (validInputs.length === q.targets.length);
      const isAllCharsCorrect = charResults.every(r => r === true);
      const isAllSuccess = isCountMatched && isAllCharsCorrect;

      if (isAllSuccess) {
        playCorrectSound();
        this.ui.showResultView(
          true,
          '🎉 正解！',
          q.targets.map(t => t.char),
          validInputs,
          charResults
        );

        const isFinalQuestion = (this.currentQIndex === this.questions.length - 1);
        setTimeout(() => {
          if (isFinalQuestion) {
            playFanfareSound();
            this.ui.showAllClear();
          } else {
            this.currentQIndex++;
            this.loadQuestion(this.currentQIndex);
          }
        }, 3000);
      } else {
        playMistakeSound();

        let feedbackMessage = '';
        if (isOkurigana && !isCountMatched) {
          feedbackMessage = 'おしい！ 送り仮名がちがうよ。';
        } else {
          feedbackMessage = adviceMessages.join(' / ');
        }

        this.ui.showResultView(
          false,
          feedbackMessage,
          q.targets.map(t => t.char),
          validInputs,
          charResults
        );
        this.ui.updateCheckButtonState(true);
      }

    } catch (err) {
      console.error(err);
      this.ui.setMessage('判定中に通信エラーが発生しました', 'mistake');
      this.ui.updateCheckButtonState(true);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new KanjiApp();
});
