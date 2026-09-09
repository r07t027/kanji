/**
 * auth.js
 * ユーザー認証、設定モーダル（利き手・音・PIN）、セッション管理モジュール
 */
import { ensureAudioUnlocked, setAudioMuted } from './audio.js';
import { prefetchAllDataAsync, updateHandModeApi, updateSoundModeApi, updatePinApi } from './logger.js';
import { Storage } from './storage.js';

export class AuthManager {
  constructor(options = {}) {
    this.currentUser = null;
    this.clearedSets = [];
    this.prefetchPromise = options.prefetchPromise || null;

    this.onUserAuthenticated = options.onUserAuthenticated || (() => {});
    this.onHandModeChanged = options.onHandModeChanged || (() => {});

    this._bindModalEvents();
    this.applySoundSetting();
  }

  setPrefetchPromise(promise) {
    this.prefetchPromise = promise;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getClearedSets() {
    if (this.clearedSets && typeof this.clearedSets === 'object' && !Array.isArray(this.clearedSets)) {
      return Object.keys(this.clearedSets);
    }
    return Array.isArray(this.clearedSets) ? this.clearedSets : [];
  }

  addClearedSet(setId) {
    this.clearedSets = Storage.saveClearedSet(setId);
  }

  async initAuthFlow() {
    const modal = document.getElementById('login-modal');
    const selectClass = document.getElementById('select-class');
    const selectUser = document.getElementById('select-user');
    const inputPin = document.getElementById('input-pin');
    const btnSubmit = document.getElementById('btn-submit-login');
    const errorMsg = document.getElementById('login-error-msg');

    // 1. ローカルキャッシュからの自動復元チェック
    const savedUser = Storage.getCurrentUser();
    if (savedUser) {
      this.currentUser = savedUser;
      modal.style.display = 'none';

      // スプレッドシート側の最新データを確実に待機して完全同期
      if (this.prefetchPromise) {
        try {
          const prefetchRes = await this.prefetchPromise;
          if (prefetchRes && prefetchRes.success && prefetchRes.progressMap) {
            const latestProgress = prefetchRes.progressMap[this.currentUser.userId];
            const latestAuth = prefetchRes.authMap ? prefetchRes.authMap[this.currentUser.userId] : null;

            if (latestAuth) {
              this.currentUser = latestAuth;
              Storage.setCurrentUser(this.currentUser);
            }

            if (latestProgress) {
              const currentLocal = Storage.getProgress();
              const mergedProgress = {
                ...currentLocal,
                clearedSets: latestProgress.clearedSets || {},
                charStats: latestProgress.charStats || {}
              };
              Storage.setProgress(mergedProgress);
            }
          }
        } catch (e) {
          console.warn('最新データ同期失敗（オフラインフォールバック）:', e);
        }
      }

      const finalProgress = Storage.getProgress();
      const rawCleared = finalProgress.clearedSets;
      this.clearedSets = Array.isArray(rawCleared)
        ? rawCleared
        : (rawCleared && typeof rawCleared === 'object' ? Object.keys(rawCleared) : []);

      this.applyUserData();
      this.checkHandModeSetup();
      this.onUserAuthenticated(this.currentUser, this.clearedSets);
      return;
    }

    // 2. 新規ログイン時：スプレッドシート（prefetchAllData）から名簿を直接取得・展開
    selectClass.innerHTML = '<option value="">よみこみ中...</option>';
    selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
    selectUser.disabled = true;

    let prefetchRes = null;
    try {
      prefetchRes = await this.prefetchPromise;
    } catch (e) {
      prefetchRes = null;
    }

    if (!prefetchRes || !prefetchRes.success || !prefetchRes.authMap) {
      selectClass.innerHTML = '<option value="">名簿の取得に失敗しました</option>';
      modal.style.display = 'flex';
      return;
    }

    const { authMap, progressMap } = prefetchRes;
    const allUsers = Object.values(authMap);

    // クラス一覧の抽出（重複排除 & ソート）
    const classes = Array.from(new Set(allUsers.map(u => u.className).filter(Boolean))).sort();

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
      const filteredUsers = allUsers
        .filter(u => u.className === selectedClass)
        .sort((a, b) => Number(a.studentNo || 0) - Number(b.studentNo || 0));

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

      const matchedUser = authMap[selectedUserId];

      if (matchedUser && matchedUser.pin === enteredPin) {
        this.currentUser = matchedUser;
        const userProgress = progressMap[selectedUserId] || { clearedSets: {}, charStats: {} };
        const rawCleared = userProgress.clearedSets;
        this.clearedSets = Array.isArray(rawCleared)
          ? rawCleared
          : (rawCleared && typeof rawCleared === 'object' ? Object.keys(rawCleared) : []);

        Storage.setCurrentUser(this.currentUser);
        Storage.setProgress(userProgress);

        const soundMode = matchedUser.soundMode || 'on';
        Storage.setSoundEnabled(soundMode !== 'off');

        this.applyUserData();
        modal.style.display = 'none';
        this.checkHandModeSetup();
        this.onUserAuthenticated(this.currentUser, this.clearedSets);
      } else {
        errorMsg.textContent = 'パスワードがちがいます。';
        errorMsg.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'ログインする';
      }
    });

    modal.style.display = 'flex';
  }

  applyUserData() {
    if (!this.currentUser) return;

    const formattedClass = (this.currentUser.className || '')
      .replace(/(\d+)年/, '$1ねん ')
      .replace(/(\d+)組/, '$1くみ');

    document.getElementById('user-display-name').textContent = `${formattedClass} ${this.currentUser.kanaName}`;
    document.getElementById('user-info-bar').style.display = 'flex';

    const handMode = this.currentUser.handMode || 'right';
    this.onHandModeChanged(handMode === 'left');

    if (this.currentUser.soundMode) {
      Storage.setSoundEnabled(this.currentUser.soundMode !== 'off');
    }
    this.applySoundSetting();
  }

  checkHandModeSetup() {
    if (!this.currentUser) return;
    if (!this.currentUser.handMode || this.currentUser.handMode === '') {
      this.openHandModal(true);
    }
  }

  applySoundSetting() {
    const isEnabled = Storage.getSoundEnabled();
    setAudioMuted(!isEnabled);

    const btnToggleSound = document.getElementById('btn-toggle-sound');
    if (btnToggleSound) {
      btnToggleSound.textContent = isEnabled ? '🎶' : '🔇';
      btnToggleSound.title = isEnabled ? 'おと: ON' : 'おと: OFF';
    }
  }

  openHandModal(isInitial = false) {
    const handModal = document.getElementById('hand-modal');
    const btnClose = document.getElementById('btn-close-hand-modal');
    const handMsg = document.getElementById('hand-modal-msg');
    const btnRow = document.getElementById('hand-modal-btn-row');

    handMsg.textContent = '';
    handMsg.style.display = 'none';
    btnRow.style.display = 'flex';
    btnClose.style.display = isInitial ? 'none' : 'block';

    const currentHand = this.currentUser?.handMode || 'right';
    document.querySelectorAll('.btn-hand-choice:not(.btn-sound-choice)').forEach(btn => {
      btn.disabled = false;
      btn.classList.toggle('active', btn.dataset.hand === currentHand);
    });

    handModal.style.display = 'flex';
  }

  async saveHandMode(mode) {
    if (!this.currentUser) return;

    const currentHand = this.currentUser.handMode || 'right';
    const handModal = document.getElementById('hand-modal');
    const handMsg = document.getElementById('hand-modal-msg');
    const btnRow = document.getElementById('hand-modal-btn-row');
    const choiceButtons = document.querySelectorAll('.btn-hand-choice:not(.btn-sound-choice)');

    if (currentHand === mode) {
      return;
    }

    choiceButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.toggle('active', btn.dataset.hand === mode);
    });

    btnRow.style.display = 'none';
    handMsg.textContent = 'ほぞんちゅう…';
    handMsg.className = 'login-error-msg pin-status-feedback is-saving';
    handMsg.style.display = 'flex';

    const res = await updateHandModeApi(this.currentUser.userId, mode);

    if (res && res.success) {
      this.currentUser.handMode = mode;
      this.onHandModeChanged(mode === 'left');
      Storage.setCurrentUser(this.currentUser);

      handMsg.textContent = 'ききてを へんこうしました。';
      handMsg.className = 'login-error-msg pin-status-feedback is-success';

      setTimeout(() => {
        handModal.style.display = 'none';
        handMsg.style.display = 'none';
        btnRow.style.display = 'flex';
        choiceButtons.forEach(btn => btn.disabled = false);
      }, 3000);

    } else {
      handMsg.textContent = 'ほぞんできませんでした。';
      handMsg.className = 'login-error-msg pin-status-feedback is-error';

      setTimeout(() => {
        handMsg.style.display = 'none';
        btnRow.style.display = 'flex';
        choiceButtons.forEach(btn => {
          btn.disabled = false;
          btn.classList.toggle('active', btn.dataset.hand === currentHand);
        });
      }, 1800);
    }
  }

  openSoundModal() {
    const soundModal = document.getElementById('sound-modal');
    const soundMsg = document.getElementById('sound-modal-msg');
    const btnRow = document.getElementById('sound-modal-btn-row');

    soundMsg.textContent = '';
    soundMsg.style.display = 'none';
    btnRow.style.display = 'flex';

    const isEnabled = Storage.getSoundEnabled();
    const currentVal = isEnabled ? 'on' : 'off';

    document.querySelectorAll('.btn-sound-choice').forEach(btn => {
      btn.disabled = false;
      btn.classList.toggle('active', btn.dataset.sound === currentVal);
    });

    soundModal.style.display = 'flex';
  }

  async saveSoundMode(mode) {
    const soundModal = document.getElementById('sound-modal');
    const soundMsg = document.getElementById('sound-modal-msg');
    const btnRow = document.getElementById('sound-modal-btn-row');
    const choiceButtons = document.querySelectorAll('.btn-sound-choice');

    const currentlyEnabled = Storage.getSoundEnabled();
    const newEnabled = (mode === 'on');

    if (currentlyEnabled === newEnabled) {
      return;
    }

    choiceButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.toggle('active', btn.dataset.sound === mode);
    });

    btnRow.style.display = 'none';
    soundMsg.textContent = 'ほぞんちゅう…';
    soundMsg.className = 'login-error-msg pin-status-feedback is-saving';
    soundMsg.style.display = 'flex';

    Storage.setSoundEnabled(newEnabled);
    this.applySoundSetting();

    let apiSuccess = true;
    if (this.currentUser) {
      const res = await updateSoundModeApi(this.currentUser.userId, mode);
      apiSuccess = res && res.success;
      if (apiSuccess) {
        this.currentUser.soundMode = mode;
        Storage.setCurrentUser(this.currentUser);
      }
    }

    if (apiSuccess) {
      soundMsg.textContent = 'おとを へんこうしました。';
      soundMsg.className = 'login-error-msg pin-status-feedback is-success';

      setTimeout(() => {
        soundModal.style.display = 'none';
        soundMsg.style.display = 'none';
        btnRow.style.display = 'flex';
        choiceButtons.forEach(btn => btn.disabled = false);
      }, 3000);
    } else {
      Storage.setSoundEnabled(currentlyEnabled);
      this.applySoundSetting();

      soundMsg.textContent = 'ほぞんできませんでした。';
      soundMsg.className = 'login-error-msg pin-status-feedback is-error';

      setTimeout(() => {
        soundMsg.style.display = 'none';
        btnRow.style.display = 'flex';
        choiceButtons.forEach(btn => {
          btn.disabled = false;
          btn.classList.toggle('active', btn.dataset.sound === (currentlyEnabled ? 'on' : 'off'));
        });
      }, 1800);
    }
  }

  openPinModal() {
    const pinModal = document.getElementById('pin-modal');
    const inputNewPin = document.getElementById('input-new-pin');
    const pinMsg = document.getElementById('pin-modal-msg');
    const btnRow = document.querySelector('#pin-modal .modal-btn-row');
    const btnSave = document.getElementById('btn-save-pin');

    inputNewPin.value = '';
    inputNewPin.disabled = false;
    pinMsg.textContent = '';
    pinMsg.style.display = 'none';
    pinMsg.className = 'login-error-msg pin-status-feedback';
    btnRow.style.display = 'flex';
    btnSave.disabled = true;
    btnSave.textContent = 'ほぞんする';

    inputNewPin.oninput = () => {
      btnSave.disabled = (inputNewPin.value.trim().length !== 4);
    };

    btnSave.onclick = async () => {
      const newPin = inputNewPin.value.trim();
      if (newPin.length !== 4) return;

      inputNewPin.disabled = true;
      btnRow.style.display = 'none';
      pinMsg.textContent = 'ほぞんちゅう…';
      pinMsg.className = 'login-error-msg pin-status-feedback is-saving';
      pinMsg.style.display = 'flex';

      const res = await updatePinApi(this.currentUser.userId, newPin);

      if (res && res.success) {
        this.currentUser.pin = newPin;
        Storage.setCurrentUser(this.currentUser);

        pinMsg.textContent = 'パスワードを へんこうしました。';
        pinMsg.className = 'login-error-msg pin-status-feedback is-success';

        setTimeout(() => {
          pinModal.style.display = 'none';
          inputNewPin.disabled = false;
          btnRow.style.display = 'flex';
          pinMsg.style.display = 'none';
        }, 3000);

      } else {
        pinMsg.textContent = 'ほぞんできませんでした。';
        pinMsg.className = 'login-error-msg pin-status-feedback is-error';

        setTimeout(() => {
          pinMsg.style.display = 'none';
          btnRow.style.display = 'flex';
          btnSave.disabled = false;
          btnSave.textContent = 'ほぞんする';
          inputNewPin.disabled = false;
          inputNewPin.focus();
        }, 1800);
      }
    };

    pinModal.style.display = 'flex';
  }

  logout() {
    Storage.clearSession();
    location.reload();
  }

  _bindModalEvents() {
    document.getElementById('btn-open-hand-modal').addEventListener('click', () => this.openHandModal(false));
    document.getElementById('btn-close-hand-modal').addEventListener('click', () => {
      document.getElementById('hand-modal').style.display = 'none';
    });
    document.querySelectorAll('.btn-hand-choice:not(.btn-sound-choice)').forEach(btn => {
      btn.addEventListener('click', () => this.saveHandMode(btn.dataset.hand));
    });

    const btnToggleSound = document.getElementById('btn-toggle-sound');
    if (btnToggleSound) {
      btnToggleSound.addEventListener('click', () => this.openSoundModal());
    }
    const btnCloseSound = document.getElementById('btn-close-sound-modal');
    if (btnCloseSound) {
      btnCloseSound.addEventListener('click', () => {
        document.getElementById('sound-modal').style.display = 'none';
      });
    }
    document.querySelectorAll('.btn-sound-choice').forEach(btn => {
      btn.addEventListener('click', () => this.saveSoundMode(btn.dataset.sound));
    });

    document.getElementById('btn-open-pin-modal').addEventListener('click', () => this.openPinModal());
    document.getElementById('btn-cancel-pin').addEventListener('click', () => {
      document.getElementById('pin-modal').style.display = 'none';
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      if (confirm('ログアウトしますか？')) {
        this.logout();
      }
    });
  }
}