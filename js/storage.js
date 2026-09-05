/**
 * storage.js
 * localStorage セッション・進捗・挑戦履歴の永続化モジュール
 */

const STORAGE_KEYS = {
  USER: 'kanji_current_user',
  PROGRESS: 'kanji_user_progress'
};

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

// storage.js の getProgress に lastDismissDate を追加
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
        lastDismissDate: progress.lastDismissDate || '' // 追加
      };
    } catch (e) {
      console.warn('進捗情報の復元に失敗しました:', e);
      return { clearedSets: {}, charStats: {}, lastChallengeDate: '', lastDismissDate: '' };
    }
  },

  // 挑戦状を「あとに する」で閉じた日付を記録
  recordDismissToday() {
    const progress = this.getProgress();
    const today = new Date().toISOString().split('T')[0];
    progress.lastDismissDate = today;
    this.setProgress(progress);
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

  // 1文字ごとの正誤結果を即時保存（直近3件リングバッファ）
  recordCharAttempt(char, isSuccess) {
    const progress = this.getProgress();
    if (!progress.charStats[char]) {
      progress.charStats[char] = {
        history: [],
        lastAttempt: ''
      };
    }

    const stat = progress.charStats[char];
    stat.history.push(isSuccess);
    if (stat.history.length > 3) {
      stat.history.shift(); // 直近3回を保持
    }
    stat.lastAttempt = new Date().toISOString();

    this.setProgress(progress);
  },

  // 挑戦状に今日挑戦した日付を保存
  recordChallengeToday() {
    const progress = this.getProgress();
    const today = new Date().toISOString().split('T')[0];
    progress.lastChallengeDate = today;
    this.setProgress(progress);
  },

  clearSession() {
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.PROGRESS);
  }
};