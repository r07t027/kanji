/**
 * modals.js
 * 設定モーダル（ききて設定・パスワード変更）制御モジュール
 */
import { updateHandModeApi, updatePinApi } from './logger.js';
import { Storage } from './storage.js';

export class SettingsModalController {
  constructor(options = {}) {
    this.getCurrentUser = options.getCurrentUser || (() => null);
    this.onHandModeChanged = options.onHandModeChanged || (() => {});

    // ききてモーダル要素
    this.handModal = document.getElementById('hand-modal');
    this.btnCloseHand = document.getElementById('btn-close-hand-modal');
    this.handChoiceBtns = document.querySelectorAll('.btn-hand-choice');

    // PIN変更モーダル要素
    this.pinModal = document.getElementById('pin-modal');
    this.inputNewPin = document.getElementById('input-new-pin');
    this.pinMsg = document.getElementById('pin-modal-msg');
    this.btnSavePin = document.getElementById('btn-save-pin');
    this.btnCancelPin = document.getElementById('btn-cancel-pin');

    this._bindEvents();
  }

  // ==================== ききて設定 ====================
  openHandModal(isInitial = false) {
    const user = this.getCurrentUser();
    this.btnCloseHand.style.display = isInitial ? 'none' : 'block';

    const currentHand = user?.handMode || 'right';
    this.handChoiceBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.hand === currentHand);
    });

    this.handModal.style.display = 'flex';
  }

  async saveHandMode(mode) {
    const user = this.getCurrentUser();
    if (!user) return;

    user.handMode = mode;
    this.onHandModeChanged(mode === 'left');
    Storage.setCurrentUser(user);

    this.handModal.style.display = 'none';
    await updateHandModeApi(user.userId, mode);
  }

  // ==================== PIN変更 ====================
  openPinModal() {
    this.inputNewPin.value = '';
    this.pinMsg.style.display = 'none';
    this.btnSavePin.disabled = true;
    this.btnSavePin.textContent = 'ほぞんする';
    this.pinModal.style.display = 'flex';
  }

  async savePin() {
    const user = this.getCurrentUser();
    if (!user) return;

    const newPin = this.inputNewPin.value.trim();
    this.btnSavePin.disabled = true;
    this.btnSavePin.textContent = 'ほぞんちゅう...';

    const res = await updatePinApi(user.userId, newPin);
    if (res.success) {
      user.pin = newPin;
      Storage.setCurrentUser(user);
      this.pinModal.style.display = 'none';
      alert('パスワードを へんこうしました！');
    } else {
      this.pinMsg.textContent = 'へんこう できませんでした。';
      this.pinMsg.style.display = 'block';
      this.btnSavePin.disabled = false;
      this.btnSavePin.textContent = 'ほぞんする';
    }
  }

  _bindEvents() {
    // ききてモーダル
    this.btnCloseHand.addEventListener('click', () => {
      this.handModal.style.display = 'none';
    });
    this.handChoiceBtns.forEach(btn => {
      btn.addEventListener('click', () => this.saveHandMode(btn.dataset.hand));
    });

    // PIN変更モーダル
    this.btnCancelPin.addEventListener('click', () => {
      this.pinModal.style.display = 'none';
    });
    this.inputNewPin.addEventListener('input', () => {
      this.btnSavePin.disabled = (this.inputNewPin.value.trim().length !== 4);
    });
    this.btnSavePin.addEventListener('click', () => this.savePin());
  }
}