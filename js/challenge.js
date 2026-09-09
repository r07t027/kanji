/**
 * challenge.js
 * 「かきまるからのちょうせん！」出題生成 ＆ 条件判定モジュール
 */

const COOL_DOWN_DAYS = 7; // クールダウン期間（日数）[cite: 15]

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class ChallengeManager {
  constructor(gradeData, storage) {
    this.gradeData = gradeData;
    this.storage = storage;
  }

  // 今日の挑戦が可能か（まだ今日勝負しておらず、5問作れるか）[cite: 15]
  canChallengeToday() {
    const progress = this.storage.getProgress();
    const today = getLocalDateString();

    if (progress.lastChallengeDate === today) {
      return false;
    }

    const clearedSetIds = Object.keys(progress.clearedSets || {});
    if (clearedSetIds.length === 0) {
      return false;
    }

    const questions = this.generateQuestions();
    return questions !== null && questions.length === 5;
  }

  // 起動時に自動ポップアップを出すべきか[cite: 15]
  shouldShowPopupToday() {
    if (!this.canChallengeToday()) return false;
    const progress = this.storage.getProgress();
    const today = getLocalDateString();
    return progress.lastDismissDate !== today;
  }

  // アラカルト5問を生成[cite: 15]
  generateQuestions() {
    if (!this.gradeData || !this.gradeData.sets) return null;

    const progress = this.storage.getProgress();
    const clearedSetIds = Object.keys(progress.clearedSets || {});
    if (clearedSetIds.length === 0) return null;

    const now = new Date().getTime();
    const msCoolDown = COOL_DOWN_DAYS * 24 * 60 * 60 * 1000;

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
    const usedChars = new Set();

    // プールA: 苦手漢字（要復習）[cite: 15]
    const weakCandidates = [];
    Object.entries(progress.charStats || {}).forEach(([char, stat]) => {
      const history = stat.history || [];
      const correctCount = history.filter(h => h === true).length;
      const winRate = history.length > 0 ? (correctCount / history.length) : 0;
      const lastAttemptMs = new Date(stat.lastAttempt || 0).getTime();

      if (winRate < 0.67 && (now - lastAttemptMs) >= msCoolDown) {
        weakCandidates.push({
          char,
          winRate,
          lastAttemptMs
        });
      }
    });

    weakCandidates.sort((a, b) => {
      if (a.winRate !== b.winRate) return a.winRate - b.winRate;
      return a.lastAttemptMs - b.lastAttemptMs;
    });

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

    // プールB: 過去合格問題[cite: 15]
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