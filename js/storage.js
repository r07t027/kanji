/**
 * storage.js
 * localStorage セッション・進捗・挑戦履歴の永続化モジュール
 */

const STORAGE_KEYS = {
  USER: 'kanji_current_user',
  PROGRESS: 'kanji_user_progress',
  SOUND: 'kanji_sound_enabled'
};

// 漢字判定用正規表現（CJK統合漢字・拡張A）[cite: 9]
const KANJI_REGEX = /[\u4E00-\u9FAF\u3400-\u4DBF]/;

// ローカル現地時間（JST等）の YYYY-MM-DD 文字列を取得する関数
function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const Storage = {
  getCurrentUser() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn('ユーザー情報の復元に失敗しました:', e);
      return null;
    }
  },

  setCurrentUser(user) {
    try {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    } catch (e) {
      console.warn('ユーザー情報の保存に失敗しました:', e);
    }
  },

  getSoundEnabled() {
    const val = localStorage.getItem(STORAGE_KEYS.SOUND);
    return val === null ? true : val === 'true';
  },

  setSoundEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.SOUND, enabled ? 'true' : 'false');
  },

  getProgress() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROGRESS);
      const progress = data ? JSON.parse(data) : {};
      
      let clearedSetsObj = {};
      if (Array.isArray(progress.clearedSets)) {
        progress.clearedSets.forEach(setId => {
          clearedSetsObj[setId] = new Date().toISOString();
        });
      } else if (progress.clearedSets && typeof progress.clearedSets === 'object') {
        clearedSetsObj = progress.clearedSets;
      }

      return {
        clearedSets: clearedSetsObj,
        charStats: progress.charStats || {},
        lastChallengeDate: progress.lastChallengeDate || '',
        lastDismissDate: progress.lastDismissDate || '',
        lastDrillDismissDate: progress.lastDrillDismissDate || ''
      };
    } catch (e) {
      console.warn('進捗情報の復元に失敗しました:', e);
      return { clearedSets: {}, charStats: {}, lastChallengeDate: '', lastDismissDate: '', lastDrillDismissDate: '' };
    }
  },

  setProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
    } catch (e) {
      console.warn('進捗情報の保存に失敗しました:', e);
    }
  },

  saveClearedSet(setId) {
    const progress = this.getProgress();
    progress.clearedSets[setId] = new Date().toISOString();
    this.setProgress(progress);
    return Object.keys(progress.clearedSets);
  },

  recordCharAttempt(char, isSuccess) {
    if (!char || !KANJI_REGEX.test(char)) {
      return;
    }

    const progress = this.getProgress();
    if (!progress.charStats) {
      progress.charStats = {};
    }

    const existingStat = progress.charStats[char];

    if (!existingStat && isSuccess) {
      return;
    }

    if (!existingStat) {
      progress.charStats[char] = {
        history: [],
        lastAttempt: '',
        drillCleared: false
      };
    }

    const stat = progress.charStats[char];
    stat.history.push(isSuccess);
    if (stat.history.length > 3) {
      stat.history.shift();
    }
    stat.lastAttempt = new Date().toISOString();

    if (!isSuccess) {
      stat.drillCleared = false;
    }

    this.setProgress(progress);
  },

  getDrillTargets() {
    const progress = this.getProgress();
    const charStats = progress.charStats || {};
    const targets = [];

    Object.entries(charStats).forEach(([char, stat]) => {
      if (!char || !KANJI_REGEX.test(char)) return;
      const history = stat.history || [];
      if (history.length === 0) return;

      const lastResult = history[history.length - 1];
      if (lastResult === false && stat.drillCleared !== true) {
        targets.push({
          char,
          history: [...history],
          lastAttempt: stat.lastAttempt || ''
        });
      }
    });

    targets.sort((a, b) => new Date(b.lastAttempt).getTime() - new Date(a.lastAttempt).getTime());
    return targets;
  },

  markDrillCleared(char) {
    if (!char) return;
    const progress = this.getProgress();
    if (progress.charStats && progress.charStats[char]) {
      progress.charStats[char].drillCleared = true;
      this.setProgress(progress);
    }
  },

  recordChallengeToday() {
    const progress = this.getProgress();
    progress.lastChallengeDate = getLocalDateString();
    this.setProgress(progress);
  },

  recordDismissToday() {
    const progress = this.getProgress();
    progress.lastDismissDate = getLocalDateString();
    this.setProgress(progress);
  },

  recordDrillDismissToday() {
    const progress = this.getProgress();
    progress.lastDrillDismissDate = getLocalDateString();
    this.setProgress(progress);
  },

  // 本日特訓ポップアップを出すべきか
  shouldShowDrillPopupToday() {
    const targets = this.getDrillTargets();
    if (targets.length === 0) return false;
    const progress = this.getProgress();
    const today = getLocalDateString();
    return progress.lastDrillDismissDate !== today;
  },

  resetChallengeLimit() {
    const progress = this.getProgress();
    progress.lastChallengeDate = '';
    progress.lastDismissDate = '';
    progress.lastDrillDismissDate = '';
    this.setProgress(progress);
  },

  clearSession() {
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.PROGRESS);
  }
};