// UI描画・DOM操作モジュール
import { KanjiVGPlayer } from './kanjivg.js';

export class UIController {
  constructor() {
    // 左ペイン要素
    this.questionTextEl = document.getElementById('question-text');
    this.questionNoticeEl = document.getElementById('question-notice');
    this.progressEl = document.getElementById('progress-text');
    this.statusEl = document.getElementById('status-message');

    // 右ペイン要素（描画エリア）
    this.drawingContainer = document.getElementById('drawing-container');
    this.charTabsEl = document.getElementById('char-tabs');
    this.strokeInfoEl = document.getElementById('stroke-info');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.btnPrev = document.getElementById('btn-prev');
    this.btnNext = document.getElementById('btn-next');
    this.btnCheck = document.getElementById('btn-check');

    // 右ペイン要素（判定結果比較・アドバイス・やり直しボタン）
    this.resultComparisonArea = document.getElementById('result-comparison-area');
    this.correctCardTitleEl = document.getElementById('correct-card-title');
    this.correctCharsContainer = document.getElementById('correct-chars-container');
    this.userCanvasesContainer = document.getElementById('user-canvases-container');
    this.resultLabelEl = document.getElementById('result-label');
    this.btnRestartAll = document.getElementById('btn-restart-all');
  }

  setMessage(text, type = '') {
    this.statusEl.textContent = text;
    this.statusEl.className = 'status-msg ' + type;
    this.statusEl.style.display = text ? 'block' : 'none';
  }

  updateQuestionHeader(qIndex, totalQuestions, sentenceHtml, noticeText) {
    this.questionTextEl.innerHTML = sentenceHtml;
    this.progressEl.textContent = `もんだい ${qIndex + 1} / ${totalQuestions}`;

    if (noticeText) {
      this.questionNoticeEl.textContent = noticeText;
      this.questionNoticeEl.style.display = 'inline-block';
    } else {
      this.questionNoticeEl.style.display = 'none';
    }

    // 通常描画状態にリセット
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

  updateNavButtons(currentIndex, totalCount, isOkurigana, maxChars) {
    this.btnPrev.style.display = (currentIndex > 0) ? 'inline-block' : 'none';

    if (isOkurigana) {
      const atMax = (currentIndex >= maxChars - 1);
      this.btnNext.style.display = atMax ? 'none' : 'inline-block';
    } else {
      this.btnNext.style.display = (currentIndex < totalCount - 1) ? 'inline-block' : 'none';
    }
  }

  updateCheckButtonState(canCheck) {
    this.btnCheck.disabled = !canCheck;
  }

  isKanji(char) {
    return /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(char);
  }

  /**
   * 判定結果画面の描画（右カラム内に比較カード ＋ アドバイスメッセージ ＋ やり直すボタン）
   */
  showResultView(isAllSuccess, messageHtml, targetChars, userInputs, charResults) {
    // 1. 上段: あなたの答えの描画 (縮小Canvas)
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

    // 2. 下段: 正解のお手本の描画（KanjiVG SVG / ひらがなはフォント）
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

    // 3. 右カラム下部のアドバイスメッセージ & やり直すボタンの制御
    this.resultLabelEl.innerHTML = messageHtml;
    this.resultLabelEl.className = 'result-label ' + (isAllSuccess ? 'success' : 'mistake');
    this.btnRestartAll.style.display = isAllSuccess ? 'none' : 'inline-block';

    // 4. ペイン表示切り替え
    this.drawingContainer.style.display = 'none';
    this.resultComparisonArea.style.display = 'flex';
  }

  showAllClear() {
    this.resultComparisonArea.style.display = 'none';
    this.progressEl.textContent = '全問クリア！';
    this.questionNoticeEl.style.display = 'none';
    this.questionTextEl.innerHTML = '🎉 はなまる満点！<br>おめでとう！ 🏆';
    this.setMessage('すべての問題をクリアしました！', 'success');
  }
}
