// UI描画・DOM操作モジュール
import { KanjiVGPlayer } from './kanjivg.js';

export class UIController {
  constructor() {
    // 画面ビュー
    this.menuView = document.getElementById('menu-view');
    this.practiceView = document.getElementById('practice-view');
    this.allClearView = document.getElementById('all-clear-view');

    // 問題提示ペイン要素
    this.unitTitleDisplay = document.getElementById('unit-title-display');
    this.questionTextEl = document.getElementById('question-text');
    this.questionNoticeEl = document.getElementById('question-notice');
    this.progressEl = document.getElementById('progress-text');
    this.statusEl = document.getElementById('status-message');

    // 描画・結果確認ペイン要素
    this.drawingContainer = document.getElementById('drawing-container');
    this.charTabsEl = document.getElementById('char-tabs');
    this.strokeInfoEl = document.getElementById('stroke-info');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.btnPrev = document.getElementById('btn-prev');
    this.btnNext = document.getElementById('btn-next');
    this.btnCheck = document.getElementById('btn-check');

    // 判定結果表示要素
    this.resultComparisonArea = document.getElementById('result-comparison-area');
    this.correctCardTitleEl = document.getElementById('correct-card-title');
    this.correctCharsContainer = document.getElementById('correct-chars-container');
    this.userCanvasesContainer = document.getElementById('user-canvases-container');
    this.resultLabelEl = document.getElementById('result-label');
    this.btnRestartAll = document.getElementById('btn-restart-all');
  }

  setHandedness(isLeftHanded) {
    if (isLeftHanded) {
      this.practiceView.classList.add('left-handed');
    } else {
      this.practiceView.classList.remove('left-handed');
    }
  }

  showMenuView() {
    this.practiceView.style.display = 'none';
    this.allClearView.style.display = 'none';
    this.menuView.style.display = 'flex';
  }

  showPracticeView() {
    this.menuView.style.display = 'none';
    this.allClearView.style.display = 'none';
    this.practiceView.style.display = 'flex';
  }

  showAllClear() {
    this.practiceView.style.display = 'none';
    this.allClearView.style.display = 'flex';
  }

  setMessage(text, type = '') {
    this.statusEl.textContent = text;
    this.statusEl.className = 'status-msg ' + type;
    this.statusEl.style.display = text ? 'block' : 'none';
  }

  updateQuestionHeader(unitTitle, qIndex, totalQuestions, sentenceHtml, noticeText) {
    this.unitTitleDisplay.textContent = unitTitle;
    this.questionTextEl.innerHTML = sentenceHtml;
    this.progressEl.textContent = `もんだい ${qIndex + 1} / ${totalQuestions}`;

    if (noticeText) {
      this.questionNoticeEl.textContent = noticeText;
      this.questionNoticeEl.style.display = 'inline-block';
    } else {
      this.questionNoticeEl.style.display = 'none';
    }

    this.drawingContainer.style.display = 'flex';
    this.resultComparisonArea.style.display = 'none';
    this.resultLabelEl.textContent = '';
    this.btnRestartAll.style.display = 'none';
  }

  renderTabs(totalCount, currentCharIndex, userInputs, onTabClick, isOkurigana) {
    this.charTabsEl.innerHTML = '';
    
    for (let i = 0; i < totalCount; i++) {
      const tab = document.createElement('div');
      tab.className = 'char-tab';
      if (i === currentCharIndex) tab.classList.add('active');
      if (userInputs[i] && userInputs[i].strokeCount > 0) tab.classList.add('done');
      tab.textContent = `${i + 1}文字目`;

      tab.addEventListener('click', () => onTabClick(i));
      this.charTabsEl.appendChild(tab);
    }
  }

  updateStrokeInfo(currentCount, targetCount, isOkurigana, currentCharIndex) {
    if (isOkurigana && currentCharIndex > 0) {
      this.strokeInfoEl.textContent = '';
    } else {
      this.strokeInfoEl.textContent = `いまの画数: ${currentCount}画 (目標: ${targetCount}画)`;
    }
  }

  updateHistoryButtons(canUndo, canRedo) {
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;
  }

  updateNavButtons(currentIndex, totalChars, isOkurigana, maxChars = 4) {
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    btnPrev.disabled = (currentIndex === 0);

    if (isOkurigana) {
      btnNext.disabled = (currentIndex >= maxChars - 1);
    } else {
      btnNext.disabled = (currentIndex >= totalChars - 1);
    }
  }

  updateCheckButtonState(canCheck) {
    this.btnCheck.disabled = !canCheck;
  }

  isKanji(char) {
    return /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(char);
  }

  showResultView(isAllSuccess, messageHtml, targetChars, userInputs, charResults) {
    this.userCanvasesContainer.innerHTML = '';
    userInputs.forEach((input, index) => {
      const isCharOk = charResults[index];

      const wrapper = document.createElement('div');
      wrapper.className = `user-char-wrapper ${isCharOk ? 'is-correct' : 'is-wrong'}`;

      const badge = document.createElement('div');
      badge.className = `judge-badge ${isCharOk ? 'badge-ok' : 'badge-ng'}`;
      badge.textContent = isCharOk ? '◯' : '✕';
      wrapper.appendChild(badge);

      const miniCanvas = document.createElement('canvas');
      miniCanvas.width = 64;
      miniCanvas.height = 64;
      miniCanvas.className = 'user-mini-canvas';
      const mCtx = miniCanvas.getContext('2d');
      mCtx.lineWidth = 3.5;
      mCtx.lineCap = 'round';
      mCtx.lineJoin = 'round';
      mCtx.strokeStyle = isCharOk ? '#2e7d32' : '#d32f2f';

      if (input && input.strokesData) {
        input.strokesData.forEach(stroke => {
          if (stroke.length === 0) return;
          mCtx.beginPath();
          mCtx.moveTo(stroke[0][0] * (64 / 260), stroke[0][1] * (64 / 260));
          for (let i = 1; i < stroke.length; i++) {
            mCtx.lineTo(stroke[i][0] * (64 / 260), stroke[i][1] * (64 / 260));
          }
          mCtx.stroke();
        });
      }
      wrapper.appendChild(miniCanvas);
      this.userCanvasesContainer.appendChild(wrapper);
    });

    this.correctCharsContainer.innerHTML = '';

    if (isAllSuccess) {
      this.correctCardTitleEl.textContent = '💡 正解のお手本（教科書体）';
    } else {
      this.correctCardTitleEl.textContent = '🎬 正解のお手本（タッチ・クリックで筆順再生）';
    }

    targetChars.forEach(char => {
      const item = document.createElement('div');
      item.className = 'correct-char-item';

      if (this.isKanji(char)) {
        new KanjiVGPlayer(item, char, !isAllSuccess);
      } else {
        const textSpan = document.createElement('span');
        textSpan.className = 'correct-kana-text';
        textSpan.textContent = char;
        item.appendChild(textSpan);
      }

      this.correctCharsContainer.appendChild(item);
    });

    this.resultLabelEl.innerHTML = messageHtml;
    this.resultLabelEl.className = 'result-label ' + (isAllSuccess ? 'success' : 'mistake');
    this.btnRestartAll.style.display = isAllSuccess ? 'none' : 'inline-block';

    this.drawingContainer.style.display = 'none';
    this.resultComparisonArea.style.display = 'flex';
  }
}