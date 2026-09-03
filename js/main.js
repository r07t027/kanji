// アプリケーション統合・エントリーポイント
import { initAudioUnlock, ensureAudioUnlocked, playCorrectSound, playFanfareSound, playMistakeSound } from './audio.js';
import { CanvasController } from './canvas.js';
import { recognizeChar } from './recognition.js';
import { UIController } from './ui.js';
import { fetchClassAndUsersFromLocal, prefetchAllDataAsync, saveProgressAndLogs } from './logger.js';

class KanjiApp {
  constructor() {
    this.gradeData = null;
    this.selectedSetId = '1学期_01';
    this.currentSet = null;
    this.currentQIndex = 0;
    this.currentCharIndex = 0;
    this.userInputs = [];
    this.isLeftHanded = false;

    // OCR許容順位を「第2候補まで」に固定設定
    this.candidateLimit = 2;

    // ユーザー情報・進捗サマリー・セッションログ
    this.currentUser = null;
    this.clearedSets = [];
    this.currentSessionLogs = [];
    this.currentMistakes = [];

    // 事前先読みプロミス
    this.prefetchPromise = null;

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

    // 1. 起動と同時にバックグラウンドでスプレッドシートの先読みを開始
    this.prefetchPromise = prefetchAllDataAsync();

    // 2. 問題データの取得
    try {
      const res = await fetch('data/grade5_questions.json');
      this.gradeData = await res.json();
    } catch (e) {
      console.error('問題データの読み込みに失敗しました:', e);
      this.ui.setMessage('問題データの読み込みに失敗しました', 'mistake');
    }

    // 3. 認証フローの開始
    await this.initAuthFlow();
  }

  /**
   * 認証・ログインモーダル制御（事前先読み＋ローカルキャッシュ対応）
   */
  async initAuthFlow() {
    const modal = document.getElementById('login-modal');
    const selectClass = document.getElementById('select-class');
    const selectUser = document.getElementById('select-user');
    const inputPin = document.getElementById('input-pin');
    const btnSubmit = document.getElementById('btn-submit-login');
    const errorMsg = document.getElementById('login-error-msg');

    // ① 自動ログイン判定
    try {
      const savedUserJson = localStorage.getItem('kanji_current_user');
      const savedProgressJson = localStorage.getItem('kanji_user_progress');
      if (savedUserJson && savedProgressJson) {
        this.currentUser = JSON.parse(savedUserJson);
        const progress = JSON.parse(savedProgressJson);
        this.clearedSets = progress.clearedSets || [];
        this.applyUserData();
        modal.style.display = 'none';
        this.setupMenuUI();
        return;
      }
    } catch (e) {}

    // ② 未ログイン時はローカル users.json から即座に描画
    const res = await fetchClassAndUsersFromLocal();
    if (!res.success) {
      selectClass.innerHTML = '<option value="">名簿の取得に失敗しました</option>';
      modal.style.display = 'flex';
      return;
    }

    const { classes, users } = res;

    selectClass.innerHTML = '<option value="">クラスを えらんでね</option>';
    classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      selectClass.appendChild(opt);
    });

    selectClass.addEventListener('change', () => {
      const selectedClass = selectClass.value;
      selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
      inputPin.value = '';
      btnSubmit.disabled = true;
      errorMsg.style.display = 'none';

      if (!selectedClass) {
        selectUser.disabled = true;
        return;
      }

      const filteredUsers = users.filter(u => u.className === selectedClass);
      filteredUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.userId;
        // 番号を含めず、名前（ひらがな）のみを表示
        opt.textContent = u.kanaName;
        selectUser.appendChild(opt);
      });
      selectUser.disabled = false;
    });

    const checkFormReady = () => {
      btnSubmit.disabled = !(selectUser.value && inputPin.value.length === 4);
    };

    selectUser.addEventListener('change', checkFormReady);
    inputPin.addEventListener('input', checkFormReady);

    // ③ ログインボタン押下時
    btnSubmit.addEventListener('click', async () => {
      ensureAudioUnlocked();
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'かくにん中...⏳';
      errorMsg.style.display = 'none';

      const selectedUserId = selectUser.value;
      const enteredPin = inputPin.value.trim();

      const prefetchRes = await this.prefetchPromise;

      if (!prefetchRes || !prefetchRes.success) {
        errorMsg.textContent = 'データの接続に失敗しました。もう一度お試しください。';
        errorMsg.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'ログインする ➔';
        this.prefetchPromise = prefetchAllDataAsync();
        return;
      }

      const { authMap, progressMap } = prefetchRes;
      const matchedUser = authMap[selectedUserId];

      if (matchedUser && matchedUser.pin === enteredPin) {
        this.currentUser = matchedUser;
        const userProgress = progressMap[selectedUserId] || { clearedSets: [], weakChars: {} };
        this.clearedSets = userProgress.clearedSets || [];

        localStorage.setItem('kanji_current_user', JSON.stringify(this.currentUser));
        localStorage.setItem('kanji_user_progress', JSON.stringify(userProgress));

        this.applyUserData();
        modal.style.display = 'none';
        this.setupMenuUI();
      } else {
        errorMsg.textContent = 'パスワードがちがいます。';
        errorMsg.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'ログインする ➔';
      }
    });

    modal.style.display = 'flex';
  }

  applyUserData() {
    if (!this.currentUser) return;

    // ユーザー情報バー表示
    document.getElementById('user-display-name').textContent = `${this.currentUser.className} ${this.currentUser.kanaName}`;
    document.getElementById('user-info-bar').style.display = 'flex';

    // 利き手設定を反映
    const handMode = this.currentUser.handMode || 'right';
    this.isLeftHanded = (handMode === 'left');
    const radio = document.querySelector(`input[name="hand-mode"][value="${handMode}"]`);
    if (radio) radio.checked = true;
    this.ui.setHandedness(this.isLeftHanded);
  }

  logout() {
    localStorage.removeItem('kanji_current_user');
    localStorage.removeItem('kanji_user_progress');
    location.reload();
  }

  savePreferences() {
    try {
      localStorage.setItem('kanji_hand_mode', this.isLeftHanded ? 'left' : 'right');
    } catch (e) {}
  }

  bindEvents() {
    document.getElementById('btn-logout').addEventListener('click', () => {
      if (confirm('ログアウトして、別のなまえで ログインしなおしますか？')) {
        this.logout();
      }
    });

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
      this.setupMenuUI();
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
      this.setupMenuUI();
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
    if (!this.gradeData) return;

    const termTabs = document.querySelectorAll('.term-tab:not(.term-tab-disabled)');
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

        if (this.clearedSets.includes(setObj.id)) {
          const badge = document.createElement('span');
          badge.className = 'set-badge-clear';
          badge.textContent = '💮';
          btn.appendChild(badge);
        }

        btn.addEventListener('click', () => {
          this.selectedSetId = setObj.id;
          document.querySelectorAll('.set-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });

        container.appendChild(btn);
      });
    };

    termTabs.forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderGrid(tab.dataset.term);
      };
    });

    const activeTab = document.querySelector('.term-tab.active') || termTabs[0];
    renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  startSet(setId) {
    this.selectedSetId = setId;
    this.currentSet = this.gradeData.sets.find(s => s.id === setId);
    if (!this.currentSet) return;

    this.currentSessionLogs = [];
    this.currentMistakes = [];

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
      this.setupMenuUI();
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
      const questionLogDetail = { chars: [] };

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
          questionLogDetail.chars.push({ target: target.char, strokes: 0, recognized: '', error: 'empty' });
          continue;
        }

        const candidates = await recognizeChar(input.strokesData);
        const recognized = candidates[0] || '';

        // 第2候補までで判定
        const isCharMatched = candidates.slice(0, this.candidateLimit).includes(target.char);

        if (!isCharMatched) {
          charResults.push(false);
          this.currentMistakes.push(target.char);
          adviceMessages.push({
            index: i,
            type: 'char',
            msg: `${i + 1}文字目: ちがう字を書いているかも？（認識: 「${recognized || '？'}」）`
          });
          questionLogDetail.chars.push({ target: target.char, strokes: input.strokeCount, recognized, error: 'char_mismatch' });
          continue;
        }

        if (input.strokeCount !== target.strokes) {
          charResults.push(false);
          this.currentMistakes.push(target.char);
          adviceMessages.push({
            index: i,
            type: 'stroke',
            msg: `${i + 1}文字目: 画数がちがうよ（目標: ${target.strokes}画 / 入力: ${input.strokeCount}画）`
          });
          questionLogDetail.chars.push({ target: target.char, strokes: input.strokeCount, recognized, error: 'stroke_mismatch' });
          continue;
        }

        charResults.push(true);
        questionLogDetail.chars.push({ target: target.char, strokes: input.strokeCount, recognized, isOk: true });
      }

      const isCountMatched = (validInputs.length === q.targets.length);
      const isAllCharsCorrect = charResults.every(r => r === true);
      const isAllSuccess = isCountMatched && isAllCharsCorrect;

      this.currentSessionLogs.push({
        qIndex: this.currentQIndex + 1,
        isSuccess: isAllSuccess,
        detail: questionLogDetail
      });

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
        setTimeout(async () => {
          if (isFinalQuestion) {
            playFanfareSound();
            this.ui.showAllClear();

            if (!this.clearedSets.includes(this.selectedSetId)) {
              this.clearedSets.push(this.selectedSetId);
            }

            if (this.currentUser) {
              await saveProgressAndLogs(
                this.currentUser.userId,
                this.selectedSetId,
                true,
                this.currentMistakes,
                this.currentSessionLogs
              );
            }
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