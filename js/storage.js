/**
 * storage.js
 * localStorage セッション・進捗・挑戦履歴の永続化モジュール
 */

const STORAGE_KEYS = {
  USER: 'kanji_current_user',
  PROGRESS: 'kanji_user_progress'
};

// 漢字判定用正規表現（CJK統合漢字・拡張A）
const KANJI_REGEX = /[\u4E00-\u9FAF\u3400-\u4DBF]/;

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

  getProgress() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROGRESS);
      const progress = data ? JSON.parse(data) : {};
      
      // 後方互換性ガード（clearedSets が配列の場合は連想配列へ正規化）
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
        lastDismissDate: progress.lastDismissDate || ''
      };
    } catch (e) {
      console.warn('進捗情報の復元に失敗しました:', e);
      return { clearedSets: {}, charStats: {}, lastChallengeDate: '', lastDismissDate: '' };
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

  /**
   * 1文字ごとの正誤結果を記録
   * - 漢字以外は除外
   * - 一度も間違えていない初見正解（true）は記録しない（苦手漢字のみを対象とする）
   * - 過去に間違えたことがある漢字は、復習・克服状況を更新するため true も記録する
   */
  recordCharAttempt(char, isSuccess) {
    // ひらがな・カタカナ・記号などは除外し、漢字のみを対象とする
    if (!char || !KANJI_REGEX.test(char)) {
      return;
    }

    const progress = this.getProgress();
    if (!progress.charStats) {
      progress.charStats = {};
    }

    const existingStat = progress.charStats[char];

    // 初めて書く漢字で、正解（true）の場合は苦手リストに登録不要
    if (!existingStat && isSuccess) {
      return;
    }

    // 初めての間違い（false）、または既に苦手リストに入っている漢字の更新
    if (!existingStat) {
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

  // 挑戦状を「あとに する」で閉じた日付を記録
  recordDismissToday() {
    const progress = this.getProgress();
    const today = new Date().toISOString().split('T')[0];
    progress.lastDismissDate = today;
    this.setProgress(progress);
  },

  // 動作確認用：1日1回の挑戦制限（挑戦日・辞退日）をリセット
  resetChallengeLimit() {
    const progress = this.getProgress();
    progress.lastChallengeDate = '';
    progress.lastDismissDate = '';
    this.setProgress(progress);
  },

  clearSession() {
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.PROGRESS);
  }
};