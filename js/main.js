// アプリケーション統合・エントリーポイント
import { initAudioUnlock, ensureAudioUnlocked, playCorrectSound, playFanfareSound, playMistakeSound } from './audio.js';
import { CanvasController } from './canvas.js';
import { recognizeChar } from './recognition.js';
import { UIController } from './ui.js';
import { sendLog } from './logger.js';

class KanjiApp {
  constructor() {
    this.gradeData = null;
    this.selectedSetId = '1学期_01';
    this.currentSet = null;
    this.currentQIndex = 0;
    this.currentCharIndex = 0;
    this.userInputs = [];
    this.isLeftHanded = false;

    this.ui = new UIController();
    this.canvasController = new CanvasController(
      document.getElementById('draw-canvas'),
      (strokeCount, strokesData, canUndo, canRedo) => this.onCanvasChange(strokeCount, strokesData, canUndo, canRedo)
    );

    this.init();
  }

  async init() {
    initAudioUnlock();
    this.loadSavedPreferences();
    this.bindEvents();

    try {
      const res = await fetch('data/grade5_questions.json');
      this.gradeData = await res.json();
      this.setupMenuUI();
    } catch (e) {
      console.error('問題データの読み込みに失敗しました:', e);
      this.ui.setMessage('問題データの読み込みに失敗しました', 'mistake');
    }
  }

  loadSavedPreferences() {
    try {
      const savedHand = localStorage.getItem('kanji_hand_mode');
      if (savedHand === 'left') {
        this.isLeftHanded = true;
        const leftRadio = document.querySelector('input[name="hand-mode"][value="left"]');
        if (leftRadio) leftRadio.checked = true;
      }
    } catch (e) {}
  }

  savePreferences() {
    try {
      localStorage.setItem('kanji_hand_mode', this.isLeftHanded ? 'left' : 'right');
    } catch (e) {}
  }

  bindEvents() {
    document.getElementById('btn-reset').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleReset();
    });
    document.getElementById('btn-restart-all').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleRestartAll();
    });
    document.getElementById('btn-prev').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handlePrev();
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleNext();
    });
    document.getElementById('btn-check').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleCheck();
    });
    document.getElementById('btn-back-menu').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.ui.showMenuView();
    });

    document.getElementById('btn-undo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.undo();
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.redo();
    });

    document.getElementById('btn-clear-retry').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.startSet(this.selectedSetId);
    });
    document.getElementById('btn-clear-next').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.startNextSet();
    });
    document.getElementById('btn-clear-menu').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.ui.showMenuView();
    });

    document.getElementById('btn-start').addEventListener('click', () => {
      ensureAudioUnlocked();
      const handVal = document.querySelector('input[name="hand-mode"]:checked').value;
      this.isLeftHanded = (handVal === 'left');
      this.savePreferences();
      this.ui.setHandedness(this.isLeftHanded);
      this.startSet(this.selectedSetId);
    });

    window.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifier = isMac ? e.metaKey : e.ctrlKey;

      if (isModifier && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        ensureAudioUnlocked();
        if (e.shiftKey) {
          this.canvasController.redo();
        } else {
          this.canvasController.undo();
        }
      } else if (isModifier && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        ensureAudioUnlocked();
        this.canvasController.redo();
      }
    });
  }

  setupMenuUI() {
    const termTabs = document.querySelectorAll('.term-tab');
    const container = document.getElementById('set-grid-container');

    const renderGrid = (termNum) => {
      container.innerHTML = '';
      const prefix = `${termNum}学期_`;
      const setsInTerm = this.gradeData.sets.filter(s => s.id.startsWith(prefix));

      setsInTerm.forEach(setObj => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'set-btn';
        if (setObj.id === this.selectedSetId) btn.classList.add('selected');

        const numStr = setObj.id.split('_')[1];
        btn.textContent = `第${parseInt(numStr, 10)}回`;

        btn.addEventListener('click', () => {
          this.selectedSetId = setObj.id;
          document.querySelectorAll('.set-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });

        container.appendChild(btn);
      });
    };

    termTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        termTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderGrid(tab.dataset.term);
      });
    });

    renderGrid('1');
  }

  startSet(setId) {
    this.selectedSetId = setId;
    this.currentSet = this.gradeData.sets.find(s => s.id === setId);
    if (!this.currentSet) return;

    this.ui.showPracticeView();
    this.loadQuestion(0);
  }

  startNextSet() {
    const currentIndex = this.gradeData.sets.findIndex(s => s.id === this.selectedSetId);
    if (currentIndex >= 0 && currentIndex < this.gradeData.sets.length - 1) {
      const nextSet = this.gradeData.sets[currentIndex + 1];
      this.startSet(nextSet.id);
    } else {
      this.ui.showMenuView();
    }
  }

  getCurrentQuestion() {
    return this.currentSet.questions[this.currentQIndex];
  }

  loadQuestion(qIndex) {
    this.currentQIndex = qIndex;
    const q = this.getCurrentQuestion();
    const isOkurigana = (q.type === 'okurigana');

    this.ui.updateQuestionHeader(
      this.currentSet.title,
      qIndex,
      this.currentSet.questions.length,
      q.sentenceHtml,
      q.notice
    );

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

        if (input.strokeCount !== target.strokes) {
          charResults.push(false);
          adviceMessages.push({
            index: i,
            type: 'stroke',
            msg: `${i + 1}文字目: 画数がちがうよ（目標: ${target.strokes}画 / 入力: ${input.strokeCount}画）`
          });
          continue;
        }

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

        const isFinalQuestion = (this.currentQIndex === this.currentSet.questions.length - 1);
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
          const firstCharError = adviceMessages.find(a => a.index === 0);
          if (firstCharError) {
            feedbackHtml = firstCharError.msg;
          } else {
            feedbackHtml = 'おしい！ 送り仮名がちがうよ。';
          }
        } else {
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
