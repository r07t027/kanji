/**
 * ui.js
 * 画面DOM描画・マスコット表情連動・プレビュー表示制御モジュール
 */
import { KAKIMARU_IMAGES, CIRCLED_NUMBERS } from './constants.js';
import { ResultViewController } from './resultView.js';

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
    this.mascotImgEl = document.getElementById('mascot-img');
    this.clearMascotImgEl = document.getElementById('clear-mascot-img');

    // 描画ペイン要素
    this.drawingContainer = document.getElementById('drawing-container');
    this.charTabsEl = document.getElementById('char-tabs');
    this.targetStrokeInfoEl = document.getElementById('target-stroke-info');
    this.currentStrokeInfoEl = document.getElementById('current-stroke-info');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.btnPrev = document.getElementById('btn-prev');
    this.btnNext = document.getElementById('btn-next');
    this.btnCheck = document.getElementById('btn-check');
    this.btnPass = document.getElementById('btn-pass');

    // プレビューコンテナ
    this.previewContainer = document.getElementById('realtime-preview-container');

    // 判定結果画面コントローラー
    this.resultView = new ResultViewController();
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

    if (this.drawingContainer) {
      this.drawingContainer.style.display = 'flex';
    }
    this.resultView.hide();
    this.setMascotEmotion('info');
  }

  showAllClear() {
    this.practiceView.style.display = 'none';
    this.allClearView.style.display = 'flex';

    if (this.clearMascotImgEl) {
      this.clearMascotImgEl.src = KAKIMARU_IMAGES.clear;
    }
  }

  setMascotEmotion(type = 'info') {
    if (!this.mascotImgEl) return;
    const category = KAKIMARU_IMAGES[type] ? type : 'info';
    const images = KAKIMARU_IMAGES[category];
    const chosenSrc = images[Math.floor(Math.random() * images.length)];

    this.mascotImgEl.src = chosenSrc;
    this.mascotImgEl.style.transform = 'scale(1.15)';
    setTimeout(() => {
      this.mascotImgEl.style.transform = 'scale(1)';
    }, 200);
  }

  setMessage(text, type = 'info') {
    this.statusEl.textContent = text;
    this.statusEl.className = 'status-msg ' + (type !== 'info' ? type : '');
    this.statusEl.style.display = text ? 'block' : 'none';
    this.setMascotEmotion(type);
  }

  updateQuestionHeader(unitTitle, qIndex, sentenceHtml, noticeText) {
    this.unitTitleDisplay.textContent = unitTitle;

    if (this.progressEl) {
      this.progressEl.style.display = 'none';
    }

    const numPrefix = CIRCLED_NUMBERS[qIndex] || `${qIndex + 1}. `;
    this.questionTextEl.innerHTML = `${numPrefix}${sentenceHtml}`;

    if (noticeText) {
      let formattedNotice = noticeText;
      if (formattedNotice.includes('おくりがな') || formattedNotice.includes('送り仮名')) {
        formattedNotice = 'おくりがなまで ぜんぶ かいてね！';
      }
      this.questionNoticeEl.textContent = formattedNotice;
      this.questionNoticeEl.style.display = 'inline-block';
    } else {
      this.questionNoticeEl.style.display = 'none';
    }

    if (this.drawingContainer) {
      this.drawingContainer.style.display = 'flex';
    }
    this.resultView.hide();
  }

  renderTabs(totalCount, currentCharIndex, userInputs, onTabClick, isOkurigana) {
    this.charTabsEl.innerHTML = '';
    for (let i = 0; i < totalCount; i++) {
      const tab = document.createElement('div');
      tab.className = 'char-tab';
      if (i === currentCharIndex) tab.classList.add('active');
      if (userInputs[i] && userInputs[i].strokeCount > 0) tab.classList.add('done');
      tab.textContent = `${i + 1}もじめ`;

      tab.addEventListener('click', () => onTabClick(i));
      this.charTabsEl.appendChild(tab);
    }
  }

  updateStrokeInfo(currentCount, targetCount, isOkurigana, currentCharIndex) {
    if (isOkurigana && currentCharIndex > 0) {
      this.targetStrokeInfoEl.textContent = '';
      this.currentStrokeInfoEl.textContent = '';
    } else {
      this.targetStrokeInfoEl.textContent = `このじは ${targetCount}かく です。`;
      this.currentStrokeInfoEl.textContent = `いまの かくすう：${currentCount}かく`;
    }
  }

  updateHistoryButtons(canUndo, canRedo) {
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;
  }

  updateNavButtons(currentIndex, totalChars, isOkurigana, maxChars = 4) {
    this.btnPrev.disabled = (currentIndex === 0);
    if (isOkurigana) {
      this.btnNext.disabled = (currentIndex >= maxChars - 1);
    } else {
      this.btnNext.disabled = (currentIndex >= totalChars - 1);
    }
  }

  updateCheckButtonState(canCheck) {
    this.btnCheck.disabled = !canCheck;
  }

  // ==================== リアルタイムプレビュー管理 ====================
  initPreviews(charCount, onSelectChar) {
    if (!this.previewContainer) return;
    this.previewContainer.innerHTML = '';

    for (let i = 0; i < charCount; i++) {
      const box = document.createElement('div');
      box.className = 'preview-char-box';
      box.id = `preview-box-${i}`;

      const img = document.createElement('img');
      img.className = 'preview-char-canvas';
      img.style.width = '46px';
      img.style.height = '46px';
      img.style.objectFit = 'contain';
      img.style.display = 'none';
      box.appendChild(img);

      box.addEventListener('click', () => onSelectChar(i));
      this.previewContainer.appendChild(box);
    }
  }

  updateAllPreviews(userInputs, activeIndex, currentDataUrl) {
    for (let i = 0; i < userInputs.length; i++) {
      const box = document.getElementById(`preview-box-${i}`);
      if (!box) continue;

      box.classList.toggle('active', i === activeIndex);
      const img = box.querySelector('img');
      if (!img) continue;

      if (i === activeIndex) {
        if (currentDataUrl) {
          img.src = currentDataUrl;
          img.style.display = 'block';
        } else {
          img.src = '';
          img.style.display = 'none';
        }
      } else if (userInputs[i] && userInputs[i].previewUrl) {
        img.src = userInputs[i].previewUrl;
        img.style.display = 'block';
      } else {
        img.src = '';
        img.style.display = 'none';
      }
    }
  }

  syncActivePreview(activeIndex, dataUrl) {
    const currentBox = document.getElementById(`preview-box-${activeIndex}`);
    if (!currentBox) return;

    const img = currentBox.querySelector('img');
    if (!img) return;

    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = 'block';
    } else {
      img.src = '';
      img.style.display = 'none';
    }
  }

  // ==================== 結果画面表示 ====================
  showResultView(isAllSuccess, messageHtml, targetChars, userInputs, charResults) {
    if (this.drawingContainer) {
      this.drawingContainer.style.display = 'none';
    }
    this.resultView.render(isAllSuccess, messageHtml, targetChars, userInputs, charResults);
  }
}