// アプリケーション統合・エントリーポイント
import { initAudioUnlock, ensureAudioUnlocked, playCorrectSound, playFanfareSound, playMistakeSound } from './audio.js';
import { CanvasController } from './canvas.js';
import { recognizeChar } from './recognition.js';
import { UIController } from './ui.js';
import { fetchClassAndUsersFromLocal, prefetchAllDataAsync, saveProgressAndLogs, updateHandModeApi, updatePinApi } from './logger.js';

class KanjiApp {
  constructor() {
    this.gradeData = null;
    this.selectedSetId = '1学期_01';
    this.currentSet = null;
    this.currentQIndex = 0;
    this.currentCharIndex = 0;
    this.userInputs = [];
    this.isLeftHanded = false;

    // OCR許容順位: 第2候補まで
    this.candidateLimit = 2;

    this.currentUser = null;
    this.clearedSets = [];
    this.currentSessionLogs = [];
    this.currentMistakes = [];

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

    // 1. 起動と同時にバックグラウンドで先読み開始
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

  async initAuthFlow() {
    const modal = document.getElementById('login-modal');
    const selectClass = document.getElementById('select-class');
    const selectUser = document.getElementById('select-user');
    const inputPin = document.getElementById('input-pin');
    const btnSubmit = document.getElementById('btn-submit-login');
    const errorMsg = document.getElementById('login-error-msg');

    try {
      const savedUserJson = localStorage.getItem('kanji_current_user');
      const savedProgressJson = localStorage.getItem('kanji_user_progress');
      if (savedUserJson && savedProgressJson) {
        this.currentUser = JSON.parse(savedUserJson);
        const progress = JSON.parse(savedProgressJson);
        this.clearedSets = progress.clearedSets || [];
        this.applyUserData();
        modal.style.display = 'none';
        this.checkHandModeSetup();
        this.setupMenuUI();
        return;
      }
    } catch (e) {}

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
      inputPin.value = '';
      btnSubmit.disabled = true;
      errorMsg.style.display = 'none';

      if (!selectedClass) {
        selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
        selectUser.disabled = true;
        return;
      }

      selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
      const filteredUsers = users.filter(u => u.className === selectedClass);
      filteredUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.userId;
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
        btnSubmit.textContent = 'ログインする';
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
        this.checkHandModeSetup();
        this.setupMenuUI();
      } else {
        errorMsg.textContent = 'パスワードがちがいます。';
        errorMsg.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'ログインする';
      }
    });

    modal.style.display = 'flex';
  }

  checkHandModeSetup() {
    if (!this.currentUser) return;
    if (!this.currentUser.handMode || this.currentUser.handMode === '') {
      this.openHandModal(true);
    }
  }

  applyUserData() {
    if (!this.currentUser) return;

    document.getElementById('user-display-name').textContent = `${this.currentUser.className} ${this.currentUser.kanaName}`;
    document.getElementById('user-info-bar').style.display = 'flex';

    const handMode = this.currentUser.handMode || 'right';
    this.isLeftHanded = (handMode === 'left');
    this.ui.setHandedness(this.isLeftHanded);
  }

  openHandModal(isInitial = false) {
    const handModal = document.getElementById('hand-modal');
    const btnClose = document.getElementById('btn-close-hand-modal');
    btnClose.style.display = isInitial ? 'none' : 'block';

    const currentHand = this.currentUser?.handMode || 'right';
    document.querySelectorAll('.btn-hand-choice').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.hand === currentHand);
    });

    handModal.style.display = 'flex';
  }

  async saveHandMode(mode) {
    this.isLeftHanded = (mode === 'left');
    this.currentUser.handMode = mode;
    this.ui.setHandedness(this.isLeftHanded);

    localStorage.setItem('kanji_current_user', JSON.stringify(this.currentUser));
    document.getElementById('hand-modal').style.display = 'none';
    await updateHandModeApi(this.currentUser.userId, mode);
  }

  openPinModal() {
    const pinModal = document.getElementById('pin-modal');
    const inputNewPin = document.getElementById('input-new-pin');
    const pinMsg = document.getElementById('pin-modal-msg');
    const btnSave = document.getElementById('btn-save-pin');

    inputNewPin.value = '';
    pinMsg.style.display = 'none';
    btnSave.disabled = true;
    btnSave.textContent = '保存する';

    inputNewPin.oninput = () => {
      btnSave.disabled = (inputNewPin.value.trim().length !== 4);
    };

    btnSave.onclick = async () => {
      const newPin = inputNewPin.value.trim();
      btnSave.disabled = true;
      btnSave.textContent = '保存中...';

      const res = await updatePinApi(this.currentUser.userId, newPin);
      if (res.success) {
        this.currentUser.pin = newPin;
        localStorage.setItem('kanji_current_user', JSON.stringify(this.currentUser));
        pinModal.style.display = 'none';
        alert('パスワードを変更しました！');
      } else {
        pinMsg.textContent = '変更に失敗しました。';
        pinMsg.style.display = 'block';
        btnSave.disabled = false;
        btnSave.textContent = '保存する';
      }
    };

    pinModal.style.display = 'flex';
  }

  logout() {
    localStorage.removeItem('kanji_current_user');
    localStorage.removeItem('kanji_user_progress');
    location.reload();
  }

  bindEvents() {
    document.getElementById('btn-open-hand-modal').addEventListener('click', () => this.openHandModal(false));
    document.getElementById('btn-close-hand-modal').addEventListener('click', () => {
      document.getElementById('hand-modal').style.display = 'none';
    });

    document.querySelectorAll('.btn-hand-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        this.saveHandMode(btn.dataset.hand);
      });
    });

    document.getElementById('btn-open-pin-modal').addEventListener('click', () => this.openPinModal());
    document.getElementById('btn-cancel-pin').addEventListener('click', () => {
      document.getElementById('pin-modal').style.display = 'none';
    });

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
        btn.textContent = `その${parseInt(numStr, 10)}`;

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

    const numStr = this.selectedSetId.split('_')[1];
    const termNum = this.selectedSetId.split('_')[0];
    const displayTitle = `${termNum} その${parseInt(numStr, 10)}`;

    this.ui.updateQuestionHeader(
      displayTitle,
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

    this.setupRealtimePreviews();
    this.loadCharInput(0);
  }

  /**
   * リアルタイムプレビュー枠のセットアップ
   */
  setupRealtimePreviews() {
    const container = document.getElementById('realtime-preview-container');
    container.innerHTML = '';

    for (let i = 0; i < this.userInputs.length; i++) {
      const box = document.createElement('div');
      box.className = 'preview-char-box';
      box.id = `preview-box-${i}`;

      const canvas = document.createElement('canvas');
      canvas.width = 46;
      canvas.height = 46;
      canvas.className = 'preview-char-canvas';
      box.appendChild(canvas);

      // タップでその文字に切り替え可能
      box.addEventListener('click', () => {
        if (i !== this.currentCharIndex) {
          this.saveCurrentDrawing();
          this.loadCharInput(i);
        }
      });

      container.appendChild(box);
    }

    // 枠を初期化・再構築した際に既存文字を復元描画
    this.redrawAllPreviews();
  }

  /**
   * 全プレビュー枠の再描画（タブ切り替えや枠追加時に呼ぶ）
   */
  redrawAllPreviews() {
    const mainCanvas = document.getElementById('draw-canvas');

    for (let i = 0; i < this.userInputs.length; i++) {
      const box = document.getElementById(`preview-box-${i}`);
      if (!box) continue;

      box.classList.toggle('active', i === this.currentCharIndex);
      const canvas = box.querySelector('canvas');
      if (!canvas) continue;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (i === this.currentCharIndex) {
        if (this.canvasController.strokeCount > 0) {
          ctx.drawImage(mainCanvas, 0, 0, canvas.width, canvas.height);
        }
      } else if (this.userInputs[i] && this.userInputs[i].strokeCount > 0) {
        this.drawStrokesToMiniCanvas(ctx, this.userInputs[i].strokesData, canvas.width, mainCanvas.width);
      }
    }
  }

  /**
   * リアルタイム同期（描画中の1画ごとの反映）
   */
  syncRealtimePreviews() {
    const mainCanvas = document.getElementById('draw-canvas');
    const currentBox = document.getElementById(`preview-box-${this.currentCharIndex}`);
    if (!currentBox) return;

    const canvas = currentBox.querySelector('canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.canvasController.strokeCount > 0) {
      ctx.drawImage(mainCanvas, 0, 0, canvas.width, canvas.height);
    }
  }

  /**
   * Google Input Tools 形式のストローク配列 [ [xs, ys], ... ] をミニキャンバスに描画
   */
  drawStrokesToMiniCanvas(ctx, strokesData, miniWidth, mainWidth) {
    if (!strokesData || strokesData.length === 0) return;

    ctx.save();
    const scale = miniWidth / mainWidth;
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#2b5876';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokesData.forEach(stroke => {
      const xs = stroke[0];
      const ys = stroke[1];
      if (xs && xs.length > 0 && ys && ys.length > 0) {
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let j = 1; j < xs.length; j++) {
          ctx.lineTo(xs[j], ys[j]);
        }
        ctx.stroke();
      }
    });

    ctx.restore();
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
    this.redrawAllPreviews();

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
    this.syncRealtimePreviews();
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

    const currentBox = document.getElementById(`preview-box-${this.currentCharIndex}`);
    if (currentBox) {
      const canvas = currentBox.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

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
        this.setupRealtimePreviews();
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