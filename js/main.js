/**
 * main.js
 * アプリケーション統合・エントリーポイント
 */
import { initAudioUnlock, ensureAudioUnlocked, playCorrectSound, playFanfareSound, playMistakeSound } from './audio.js';
import { CanvasController } from './canvas.js';
import { UIController } from './ui.js';
import { prefetchAllDataAsync, saveProgressAndLogs } from './logger.js';
import { AuthManager } from './auth.js';
import { MenuManager } from './menu.js';
import { AnswerValidator } from './validator.js';
import { shuffleArray, getInputAdvice, getRetryAdvice, getPraiseMessage, getMistakeMessage } from './messages.js';
import { ChallengeManager } from './challenge.js';
import { Storage } from './storage.js';

class KanjiApp {
  constructor() {
    this.gradeData = null;
    this.currentSet = null;
    this.currentQuestions = []; // 出題順にシャッフルされた問題を保持
    this.currentQIndex = 0;
    this.currentCharIndex = 0;
    this.userInputs = [];

    this.currentSessionLogs = [];
    this.currentMistakes = [];
    this.isChallengeMode = false;
    this.challengeManager = null;

    this.ui = new UIController();
    this.validator = new AnswerValidator(2);

    const prefetchPromise = prefetchAllDataAsync();

    this.auth = new AuthManager({
      prefetchPromise,
      onUserAuthenticated: (user, clearedSets) => {
        if (this.gradeData) {
          this.menu.setData(this.gradeData, clearedSets, this.menu.getSelectedSetId());
        }
      },
      onHandModeChanged: (isLeftHanded) => {
        this.ui.setHandedness(isLeftHanded);
      }
    });

    this.menu = new MenuManager({
      onSetSelected: (setId) => {}
    });

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
      const res = await fetch('data/grade5_questions.json');
      this.gradeData = await res.json();
      this.menu.setData(this.gradeData, this.auth.getClearedSets());
      this.challengeManager = new ChallengeManager(this.gradeData, Storage);
    } catch (e) {
      console.error('問題データの読み込みに失敗しました:', e);
      this.ui.setMessage('もんだいデータの よみこみに しっぱいしました。', 'mistake');
    }

    await this.auth.initAuthFlow();
    this.checkDailyChallenge();
  }

  // 1日1回の挑戦状の出現判定 & ヘッダーボタンの表示切り替え
  checkDailyChallenge() {
    const challengePanel = document.getElementById('challenge-panel');
    const normalContent = document.getElementById('normal-menu-content');
    const btnHeaderChallenge = document.getElementById('btn-header-challenge');
    if (!challengePanel || !normalContent) return;

    const canChallenge = this.challengeManager && this.challengeManager.canChallengeToday();

    if (canChallenge) {
      const shouldPopup = this.challengeManager.shouldShowPopupToday();
      if (shouldPopup) {
        // 起動時：自動で挑戦状パネルを開く
        normalContent.style.display = 'none';
        challengePanel.style.display = 'flex';
        if (btnHeaderChallenge) btnHeaderChallenge.style.display = 'none';
      } else {
        // 案内済みの場合：通常メニューを表示し、ヘッダーに挑戦ボタンを常設
        challengePanel.style.display = 'none';
        normalContent.style.display = 'block';
        if (btnHeaderChallenge) btnHeaderChallenge.style.display = 'flex';
      }
    } else {
      // そもそも条件未達、または今日すでに勝負済み
      challengePanel.style.display = 'none';
      normalContent.style.display = 'block';
      if (btnHeaderChallenge) btnHeaderChallenge.style.display = 'none';
    }
  }

  bindEvents() {
    // 描画関連ボタン
    document.getElementById('btn-reset').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleReset();
    });
    document.getElementById('btn-undo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.undo();
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.redo();
    });

    // キーボードショートカット（Undo/Redo）をキャンバス側に登録
    this.canvasController.initKeyboardShortcuts(() => {
      ensureAudioUnlocked();
    });

    // ナビゲーション・解答ボタン
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
    document.getElementById('btn-pass').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handlePass();
    });
    document.getElementById('btn-restart-all').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.handleRestartAll();
    });
    document.getElementById('btn-back-menu').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.isChallengeMode = false;
      this.ui.showMenuView();
      this.menu.render();
      this.checkDailyChallenge();
    });

    // 挑戦状パネルアクション（受けて立つ）
    const btnChallengeAccept = document.getElementById('btn-challenge-accept');
    if (btnChallengeAccept) {
      btnChallengeAccept.addEventListener('click', () => {
        ensureAudioUnlocked();
        this.startChallengeSet();
      });
    }

    // 挑戦状パネルアクション（あとに する）
    const btnChallengeDecline = document.getElementById('btn-challenge-decline');
    if (btnChallengeDecline) {
      btnChallengeDecline.addEventListener('click', () => {
        ensureAudioUnlocked();
        Storage.recordDismissToday(); // 「今日閉じた」ことを記録してリロード時の再表示を抑止
        document.getElementById('challenge-panel').style.display = 'none';
        document.getElementById('normal-menu-content').style.display = 'block';

        const btnHeader = document.getElementById('btn-header-challenge');
        if (btnHeader) btnHeader.style.display = 'flex';
      });
    }

    // ヘッダーの「🥋 かきまると しょうぶ！」ボタン押下時
    const btnHeaderChallenge = document.getElementById('btn-header-challenge');
    if (btnHeaderChallenge) {
      btnHeaderChallenge.addEventListener('click', () => {
        ensureAudioUnlocked();
        document.getElementById('normal-menu-content').style.display = 'none';
        document.getElementById('challenge-panel').style.display = 'flex';
        btnHeaderChallenge.style.display = 'none';
      });
    }

    // 全問クリア画面アクション
    document.getElementById('btn-clear-retry').addEventListener('click', () => {
      ensureAudioUnlocked();
      if (this.isChallengeMode) {
        this.startChallengeSet();
      } else {
        this.startSet(this.menu.getSelectedSetId());
      }
    });
    document.getElementById('btn-clear-next').addEventListener('click', () => {
      ensureAudioUnlocked();
      if (this.isChallengeMode) {
        this.isChallengeMode = false;
        this.ui.showMenuView();
        this.menu.render();
        this.checkDailyChallenge();
      } else {
        this.startNextSet();
      }
    });
    document.getElementById('btn-clear-menu').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.isChallengeMode = false;
      this.ui.showMenuView();
      this.menu.render();
      this.checkDailyChallenge();
    });

    // メニュー画面スタート
    document.getElementById('btn-start').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.startSet(this.menu.getSelectedSetId());
    });
  }

  // 「かきまるからのちょうせん！」開始
  startChallengeSet() {
    const questions = this.challengeManager.generateQuestions();
    if (!questions) return;

    Storage.recordChallengeToday();
    this.isChallengeMode = true;
    this.currentQuestions = questions;
    this.currentSessionLogs = [];
    this.currentMistakes = [];

    // ヘッダーボタンを非表示化
    const btnHeader = document.getElementById('btn-header-challenge');
    if (btnHeader) btnHeader.style.display = 'none';

    this.ui.showPracticeView();
    this.loadQuestion(0);
  }

  // 通常単元スタート処理（問題をシャッフル）
  startSet(setId) {
    if (!this.gradeData || !this.gradeData.sets) return;
    this.isChallengeMode = false;
    this.menu.setSelectedSetId(setId);
    this.currentSet = this.gradeData.sets.find(s => s.id === setId);
    if (!this.currentSet || !this.currentSet.questions) return;

    this.currentQuestions = shuffleArray(this.currentSet.questions);
    this.currentSessionLogs = [];
    this.currentMistakes = [];

    this.ui.showPracticeView();
    this.loadQuestion(0);
  }

  startNextSet() {
    const currentId = this.menu.getSelectedSetId();
    const currentIndex = this.gradeData.sets.findIndex(s => s.id === currentId);
    if (currentIndex >= 0 && currentIndex < this.gradeData.sets.length - 1) {
      const nextSet = this.gradeData.sets[currentIndex + 1];
      this.startSet(nextSet.id);
    } else {
      this.ui.showMenuView();
      this.menu.render();
      this.checkDailyChallenge();
    }
  }

  getCurrentQuestion() {
    if (!this.currentQuestions || this.currentQuestions.length === 0) {
      if (this.currentSet && this.currentSet.questions) {
        this.currentQuestions = shuffleArray(this.currentSet.questions);
      } else {
        return null;
      }
    }
    return this.currentQuestions[this.currentQIndex];
  }

  loadQuestion(qIndex) {
    this.currentQIndex = qIndex;
    const q = this.getCurrentQuestion();
    if (!q) return;

    const isOkurigana = (q.type === 'okurigana');

    // ヘッダータイトルの切り替え
    let displayTitle = '';
    if (this.isChallengeMode) {
      displayTitle = '🥋 かきまるとの しょうぶ！';
    } else {
      const setId = this.menu.getSelectedSetId();
      const numStr = setId.split('_')[1];
      const termNum = setId.split('_')[0].replace('学期', '');
      displayTitle = `${termNum}がっき その${parseInt(numStr, 10)}`;
    }

    this.ui.updateQuestionHeader(displayTitle, qIndex, q.sentenceHtml, q.notice);

    if (isOkurigana) {
      this.userInputs = [null];
    } else {
      const targetCount = (q.targets && q.targets.length) ? q.targets.length : 1;
      this.userInputs = new Array(targetCount).fill(null);
    }

    this.ui.initPreviews(this.userInputs.length, (i) => {
      if (i !== this.currentCharIndex) {
        this.saveCurrentDrawing();
        this.loadCharInput(i);
      }
    });

    this.loadCharInput(0);
  }

  saveCurrentDrawing() {
    const data = this.canvasController.getData();
    if (data.strokeCount > 0) {
      this.userInputs[this.currentCharIndex] = {
        ...data,
        previewUrl: this.canvasController.toDataURL()
      };
    } else {
      this.userInputs[this.currentCharIndex] = null;
    }
  }

  loadCharInput(cIndex) {
    this.currentCharIndex = cIndex;
    const q = this.getCurrentQuestion();
    if (!q) return;
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (q.targets && cIndex < q.targets.length) ? q.targets[cIndex].strokes : 0;

    this.ui.renderTabs(
      this.userInputs.length,
      cIndex,
      this.userInputs,
      (index) => {
        this.saveCurrentDrawing();
        this.loadCharInput(index);
      }
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
    this.ui.updateNavButtons(cIndex, this.userInputs.length, isOkurigana, q.maxChars || 4);
    this.ui.updateHistoryButtons(this.canvasController.canUndo(), this.canvasController.canRedo());
    this.checkButtonState();

    const currentDataUrl = currentCount > 0 ? this.canvasController.toDataURL() : '';
    this.ui.updateAllPreviews(this.userInputs, cIndex, currentDataUrl);
    this.ui.setMessage(getInputAdvice(cIndex + 1, isOkurigana), 'info');
  }

  onCanvasChange(strokeCount, strokesData, canUndo, canRedo) {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (q.targets && this.currentCharIndex < q.targets.length) ? q.targets[this.currentCharIndex].strokes : 0;

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
      }
    );

    this.checkButtonState();
    const dataUrl = strokeCount > 0 ? this.canvasController.toDataURL() : '';
    this.ui.syncActivePreview(this.currentCharIndex, dataUrl);
  }

  checkButtonState() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const isOkurigana = (q.type === 'okurigana');
    const currentFilled = this.canvasController.strokeCount > 0;

    const btnReset = document.getElementById('btn-reset');
    if (btnReset) {
      btnReset.disabled = !currentFilled;
    }

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
    if (!q) return;
    const isOkurigana = (q.type === 'okurigana');
    const targetStroke = (q.targets && this.currentCharIndex < q.targets.length) ? q.targets[this.currentCharIndex].strokes : 0;

    this.ui.updateStrokeInfo(0, targetStroke, isOkurigana, this.currentCharIndex);
    this.ui.updateHistoryButtons(false, false);
    this.ui.renderTabs(
      this.userInputs.length,
      this.currentCharIndex,
      this.userInputs,
      (index) => {
        this.saveCurrentDrawing();
        this.loadCharInput(index);
      }
    );
    this.checkButtonState();
    this.ui.syncActivePreview(this.currentCharIndex, '');
    this.ui.setMessage(getRetryAdvice(), 'info');
  }

  handleRestartAll() {
    this.loadQuestion(this.currentQIndex);
    this.ui.setMessage('1もじめから もういちど かいてみよう。おちついてね。', 'info');
  }

  handlePrev() {
    if (this.currentCharIndex === 0) return;
    this.saveCurrentDrawing();
    this.loadCharInput(this.currentCharIndex - 1);
  }

  handleNext() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const isOkurigana = (q.type === 'okurigana');

    if (this.canvasController.strokeCount === 0) {
      this.ui.setMessage('もじを かいてから つぎへ すすもうね。', 'mistake');
      return;
    }
    this.saveCurrentDrawing();

    if (isOkurigana) {
      if (this.currentCharIndex === this.userInputs.length - 1 && this.userInputs.length < (q.maxChars || 4)) {
        this.userInputs.push(null);
        this.ui.initPreviews(this.userInputs.length, (i) => {
          if (i !== this.currentCharIndex) {
            this.saveCurrentDrawing();
            this.loadCharInput(i);
          }
        });
      }
      this.loadCharInput(this.currentCharIndex + 1);
    } else {
      if (this.currentCharIndex < this.userInputs.length - 1) {
        this.loadCharInput(this.currentCharIndex + 1);
      }
    }
  }

  // パス処理（誤答をローカルへ即時記録）
  handlePass() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    if (!confirm('このもんだいを パスして おてほんを みますか？')) {
      return;
    }

    playMistakeSound();
    this.ui.setMessage('おてほんを よくみて かきじゅんを かくにんしよう。', 'mistake');

    // 各文字の誤答をローカルに即座に記録
    q.targets.forEach(t => {
      this.currentMistakes.push(t.char);
      Storage.recordCharAttempt(t.char, false);
    });

    const falseResults = new Array(q.targets.length).fill(false);
    this.ui.showResultView(
      false,
      'パスしました。おてほんを かくにんしよう。',
      q.targets.map(t => t.char),
      this.userInputs,
      falseResults
    );
    this.ui.updateCheckButtonState(true);
  }

  // 解答判定処理（正誤をローカルへ即時記録）
  async handleCheck() {
    this.saveCurrentDrawing();
    const q = this.getCurrentQuestion();
    if (!q) return;

    const btnCheck = document.getElementById('btn-check');
    btnCheck.disabled = true;
    const originalBtnText = btnCheck.textContent;
    btnCheck.textContent = 'かくにん中...';

    try {
      const {
        isAllSuccess,
        charResults,
        validInputs,
        feedbackHtml,
        mistakenChars,
        questionLogDetail
      } = await this.validator.validateQuestion(q, this.userInputs);

      // 各文字の正誤結果をローカルへ即時記録（途中で「もどる」を押されても記録が残る）
      q.targets.forEach((t, idx) => {
        const isCharOk = charResults[idx] === true;
        Storage.recordCharAttempt(t.char, isCharOk);
      });

      this.currentMistakes.push(...mistakenChars);
      this.currentSessionLogs.push({
        qIndex: this.currentQIndex + 1,
        isSuccess: isAllSuccess,
        detail: questionLogDetail
      });

      btnCheck.textContent = originalBtnText;

      if (isAllSuccess) {
        playCorrectSound();
        this.ui.setMessage(getPraiseMessage(), 'success');
        this.ui.showResultView(true, 'せいかい！', q.targets.map(t => t.char), validInputs, charResults);

    const isFinalQuestion = (this.currentQIndex === this.currentQuestions.length - 1);
        setTimeout(async () => {
          if (isFinalQuestion) {
            playFanfareSound();

            const currentUser = this.auth.getCurrentUser();
            const displayName = currentUser ? currentUser.kanaName : '';

            // 勝負モードフラグを渡して特別演出を表示
            this.ui.showAllClear(this.isChallengeMode, displayName);

            // 通常モード時のみセットクリア記録を更新
            if (!this.isChallengeMode) {
              const currentSetId = this.menu.getSelectedSetId();
              this.auth.addClearedSet(currentSetId);
              this.menu.updateClearedSets(this.auth.getClearedSets());

              if (currentUser) {
                await saveProgressAndLogs(
                  currentUser.userId,
                  currentSetId,
                  true,
                  this.currentMistakes,
                  this.currentSessionLogs
                );
              }
            } else {
              this.isChallengeMode = false; // 挑戦完了
            }
          } else {
            this.currentQIndex++;
            this.loadQuestion(this.currentQIndex);
          }
        }, 3000);

      } else {
        playMistakeSound();
        this.ui.setMessage(getMistakeMessage(), 'mistake');
        this.ui.showResultView(false, feedbackHtml, q.targets.map(t => t.char), validInputs, charResults);
        this.ui.updateCheckButtonState(true);
      }
    } catch (err) {
      console.error('判定処理エラー:', err);
      btnCheck.textContent = originalBtnText;
      this.ui.setMessage('つうしんエラーが はっせいしました。', 'mistake');
      this.ui.updateCheckButtonState(true);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new KanjiApp();
});

// デバッグ用：1日1回の制限リセット
    const btnDebugReset = document.getElementById('btn-debug-reset-challenge');
    if (btnDebugReset) {
      btnDebugReset.addEventListener('click', () => {
        ensureAudioUnlocked();
        Storage.resetChallengeLimit();
        this.checkDailyChallenge();
        alert('1日1回の制限をリセットしました！');
      });
    }