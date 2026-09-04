/**
 * auth.js
 * ユーザー認証、ログイン画面制御、セッション管理モジュール
 */
import { ensureAudioUnlocked } from './audio.js';
import { fetchClassAndUsersFromLocal, prefetchAllDataAsync } from './logger.js';
import { Storage } from './storage.js';
import { SettingsModalController } from './modals.js';

export class AuthManager {
  constructor(options = {}) {
    this.currentUser = null;
    this.clearedSets = [];
    this.prefetchPromise = options.prefetchPromise || null;

    this.onUserAuthenticated = options.onUserAuthenticated || (() => {});
    this.onHandModeChanged = options.onHandModeChanged || (() => {});

    // モーダルコントローラーの初期化
    this.settingsModal = new SettingsModalController({
      getCurrentUser: () => this.currentUser,
      onHandModeChanged: (isLeft) => this.onHandModeChanged(isLeft)
    });

    this._bindHeaderEvents();
  }

  setPrefetchPromise(promise) {
    this.prefetchPromise = promise;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getClearedSets() {
    return this.clearedSets;
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
      this.clearedSets = savedProgress.clearedSets || [];
      this.applyUserData();
      modal.style.display = 'none';
      this.checkHandModeSetup();
      this.onUserAuthenticated(this.currentUser, this.clearedSets);
      return;
    }

    // 2. ローカル静的名簿の読み込み
    const res = await fetchClassAndUsersFromLocal();
    if (!res.success) {
      selectClass.innerHTML = '<option value="">名簿の取得に失敗しました</option>';
      modal.style.display = 'flex';
      return;
    }

    const { classes, users } = res;
    selectClass.innerHTML = '<option value="">クラスを えらんでね</option>';
    selectUser.innerHTML = '<option value="">なまえを えらんでね</option>';
    selectUser.disabled = true;

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
      this.settingsModal.openHandModal(true);
    }
  }

  logout() {
    Storage.clearSession();
    location.reload();
  }

  _bindHeaderEvents() {
    document.getElementById('btn-open-hand-modal').addEventListener('click', () => {
      this.settingsModal.openHandModal(false);
    });
    document.getElementById('btn-open-pin-modal').addEventListener('click', () => {
      this.settingsModal.openPinModal();
    });
    document.getElementById('btn-logout').addEventListener('click', () => {
      if (confirm('ログアウトしますか？')) {
        this.logout();
      }
    });
  }
}