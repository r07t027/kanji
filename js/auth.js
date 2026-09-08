/**
 * auth.js
 * ユーザー認証、設定モーダル（利き手・PIN）、セッション管理モジュール
 */
import { ensureAudioUnlocked } from './audio.js';
import { fetchClassAndUsersFromLocal, prefetchAllDataAsync, updateHandModeApi, updatePinApi } from './logger.js';
import { Storage } from './storage.js';

export class AuthManager {
  constructor(options = {}) {
    this.currentUser = null;
    this.clearedSets = [];
    this.prefetchPromise = options.prefetchPromise || null;

    this.onUserAuthenticated = options.onUserAuthenticated || (() => {});
    this.onHandModeChanged = options.onHandModeChanged || (() => {});

    this._bindModalEvents();
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
    const savedProgress = Storage.getProgress();
    if (savedUser && savedProgress) {
      this.currentUser = savedUser;
      const rawCleared = savedProgress.clearedSets;
      this.clearedSets = Array.isArray(rawCleared)
        ? rawCleared
        : (rawCleared && typeof rawCleared === 'object' ? Object.keys(rawCleared) : []);

      this.applyUserData();
      modal.style.display = 'none';
      this.checkHandModeSetup();
      this.onUserAuthenticated(this.currentUser, this.clearedSets);
      return;
    }

    // 2. ローカル静的名簿（data/users.json）の読み込み
    selectClass.innerHTML = '<option value="">よみこみ中...</option>';
    selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
    selectUser.disabled = true;

    const res = await fetchClassAndUsersFromLocal();
    if (!res.success || !res.users || res.users.length === 0) {
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
        const userProgress = progressMap[selectedUserId] || { clearedSets: {}, charStats: {} };
        const rawCleared = userProgress.clearedSets;
        this.clearedSets = Array.isArray(rawCleared)
          ? rawCleared
          : (rawCleared && typeof rawCleared === 'object' ? Object.keys(rawCleared) : []);

        Storage.setCurrentUser(this.currentUser);
        Storage.setProgress(userProgress);

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
  }

  checkHandModeSetup() {
    if (!this.currentUser) return;
    if (!this.currentUser.handMode || this.currentUser.handMode === '') {
      this.openHandModal(true);
    }
  }

  // ==================== 設定モーダル制御 ====================
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
    document.querySelectorAll('.btn-hand-choice').forEach(btn => {
      btn.disabled = false;
      btn.classList.toggle('active', btn.dataset.hand === currentHand);
    });

    handModal.style.display = 'flex';
  }

  async saveHandMode(mode) {
    if (!this.currentUser) return;

    const currentHand = this.currentUser.handMode || 'right';
    const handModal = document.getElementById('hand-modal');
    const btnClose = document.getElementById('btn-close-hand-modal');
    const handMsg = document.getElementById('hand-modal-msg');
    const btnRow = document.getElementById('hand-modal-btn-row');
    const choiceButtons = document.querySelectorAll('.btn-hand-choice');

    // 既に選択されている手と同じ場合は何もしない
    if (currentHand === mode) {
      return;
    }

    // 選択ボタンのアクティブ表示更新 & ボタン類をロック
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
    document.querySelectorAll('.btn-hand-choice').forEach(btn => {
      btn.addEventListener('click', () => this.saveHandMode(btn.dataset.hand));
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