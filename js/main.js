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
      (strokeCount, strokesData, canUndo, canRedo) => this.onCanvasChange(strokeCount, strokesData, canUndo, canRedo)
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

    // アンドゥ・リドゥボタン
    document.getElementById('btn-undo').addEventListener('click', () => {
      this.canvasController.undo();
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      this.canvasController.redo();
    });

    // キーボードショートカット (Ctrl+Z / Cmd+Z, Ctrl+Y / Cmd+Shift+Z)
    window.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifier = isMac ? e.metaKey : e.ctrlKey;

      if (isModifier && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          this.canvasController.redo();
        } else {
          this.canvasController.undo();
        }
      } else if (isModifier && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        this.canvasController.redo();
      }
    });
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
        this.userInputs[cIndex].strokeCount,
        this.userInputs[cIndex].redoStack || []
      );
    } else {
      this.canvasController.clear();
    }

    const currentCount = this.canvasController.strokeCount;
    this.ui.updateStrokeInfo(currentCount, targetStroke, isOkurigana, cIndex);
    this.ui.updateNavButtons(cIndex, this.userInputs.length, isOkurigana, q.maxChars);
    this.ui.updateHistoryButtons(this.canvasController.canUndo(), this.canvasController.canRedo());
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

  onCanvasChange(strokeCount, strokesData, canUndo, canRedo) {
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (this.currentCharIndex < q.targets.length) ? q.targets[this.currentCharIndex].strokes : 0;

    this.ui.updateStrokeInfo(strokeCount, targetStroke, isOkurigana, this.currentCharIndex);
    this.ui.updateHistoryButtons(canUndo, canRedo);
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
    this.ui.updateHistoryButtons(false, false);
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
          adviceMessages.push({
            index: i,
            type: 'empty',
            msg: `${i + 1}文字目: 書かれていません`
          });
          continue;
        }

        // 1. OCR認識チェック（誤字判定最優先）
        const candidates = await recognizeChar(input.strokesData);
        const isCharMatched = candidates.slice(0, 4).includes(target.char);

        if (!isCharMatched) {
          charResults.push(false);
          adviceMessages.push({
            index: i,
            type: 'char',
            msg: `${i + 1}文字目: ちがう字を書いているかも？（認識: 「${candidates[0] || '？'}」）`
          });
          continue;
        }

        // 2. 画数チェック
        if (input.strokeCount !== target.strokes) {
          charResults.push(false);
          adviceMessages.push({
            index: i,
            type: 'stroke',
            msg: `${i + 1}文字目: 画数がちがうよ（目標: ${target.strokes}画 / 入力: ${input.strokeCount}画）`
          });
          continue;
        }

        // 正解
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

        let feedbackHtml = '';

        if (isOkurigana) {
          // 送り仮名問題のフィードバック集約:
          // 1. 1文字目（主漢字）のエラーがある場合 ➔ 1文字目のアドバイスのみ出力
          const firstCharError = adviceMessages.find(a => a.index === 0);
          if (firstCharError) {
            feedbackHtml = firstCharError.msg;
          } else {
            // 2. 1文字目が合っている場合 ➔ 「おしい！ 送り仮名がちがうよ。」に集約
            feedbackHtml = 'おしい！ 送り仮名がちがうよ。';
          }
        } else {
          // 通常問題: 全文字のエラーを改行して出力
          feedbackHtml = adviceMessages.map(a => a.msg).join('<br>');
        }

        this.ui.showResultView(
          false,
          feedbackHtml,
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
