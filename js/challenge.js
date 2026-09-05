/**
 * challenge.js
 * 「かきまるからのちょうせん！」出題生成 ＆ 条件判定モジュール
 */

const COOL_DOWN_DAYS = 7; // クールダウン期間（日数）

export class ChallengeManager {
  constructor(gradeData, storage) {
    this.gradeData = gradeData;
    this.storage = storage;
  }

  // 今日の挑戦が可能か（まだ今日勝負しておらず、5問作れるか）
  canChallengeToday() {
    const progress = this.storage.getProgress();
    const today = new Date().toISOString().split('T')[0];

    // 今日すでに「勝負」を完了している場合は不可
    if (progress.lastChallengeDate === today) {
      return false;
    }

    const clearedSetIds = Object.keys(progress.clearedSets);
    if (clearedSetIds.length === 0) {
      return false;
    }

    const questions = this.generateQuestions();
    return questions !== null && questions.length === 5;
  }

  // 起動時に自動ポップアップを出すべきか（今日まだ「あとに する」も押していない）
  shouldShowPopupToday() {
    if (!this.canChallengeToday()) return false;
    const progress = this.storage.getProgress();
    const today = new Date().toISOString().split('T')[0];
    return progress.lastDismissDate !== today;
  }

  // アラカルト5問を生成
  generateQuestions() {
    if (!this.gradeData || !this.gradeData.sets) return null;

    const progress = this.storage.getProgress();
    const clearedSetIds = Object.keys(progress.clearedSets);
    if (clearedSetIds.length === 0) return null;

    const now = new Date().getTime();
    const msCoolDown = COOL_DOWN_DAYS * 24 * 60 * 60 * 1000;

    // 過去に解いたことのあるすべての問題を収集
    const allAvailableQuestions = [];
    this.gradeData.sets.forEach(setObj => {
      if (clearedSetIds.includes(setObj.id)) {
        setObj.questions.forEach(q => {
          allAvailableQuestions.push({
            ...q,
            setId: setObj.id,
            clearedAt: new Date(progress.clearedSets[setObj.id] || 0).getTime()
          });
        });
      }
    });

    const selectedQuestions = [];
    const usedChars = new Set(); // 漢字重複防止用

    // ==================== プールA: 苦手漢字（要復習） ====================
    const weakCandidates = [];
    Object.entries(progress.charStats).forEach(([char, stat]) => {
      const history = stat.history || [];
      const correctCount = history.filter(h => h === true).length;
      const winRate = history.length > 0 ? (correctCount / history.length) : 0;
      const lastAttemptMs = new Date(stat.lastAttempt || 0).getTime();

      // 直近3回中2回以上不正解（正答率 < 0.67） かつ 7日以上経過
      if (winRate < 0.67 && (now - lastAttemptMs) >= msCoolDown) {
        weakCandidates.push({
          char,
          winRate,
          lastAttemptMs
        });
      }
    });

    // 正答率が低い順、古い順にソート
    weakCandidates.sort((a, b) => {
      if (a.winRate !== b.winRate) return a.winRate - b.winRate;
      return a.lastAttemptMs - b.lastAttemptMs;
    });

    // 該当する漢字を含む問題をプールAから選定
    for (const weak of weakCandidates) {
      if (selectedQuestions.length >= 5) break;

      const matchedQ = allAvailableQuestions.find(q => {
        const containsTarget = q.targets.some(t => t.char === weak.char);
        const hasNoOverlap = q.targets.every(t => !usedChars.has(t.char));
        return containsTarget && hasNoOverlap;
      });

      if (matchedQ) {
        selectedQuestions.push(matchedQ);
        matchedQ.targets.forEach(t => usedChars.add(t.char));
      }
    }

    // ==================== プールB: 過去合格問題（忘却曲線復習） ====================
    if (selectedQuestions.length < 5) {
      const sortedByOldestClear = [...allAvailableQuestions].sort((a, b) => a.clearedAt - b.clearedAt);

      for (const q of sortedByOldestClear) {
        if (selectedQuestions.length >= 5) break;

        const hasNoOverlap = q.targets.every(t => !usedChars.has(t.char));
        const notAlreadySelected = !selectedQuestions.some(sq => sq.sentenceHtml === q.sentenceHtml);

        if (hasNoOverlap && notAlreadySelected) {
          selectedQuestions.push(q);
          q.targets.forEach(t => usedChars.add(t.char));
        }
      }
    }

    return selectedQuestions.length === 5 ? selectedQuestions : null;
  }
}