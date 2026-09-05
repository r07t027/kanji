/**
 * ui.js
 * 画面DOM描画・マスコット表情連動・プレビュー表示・判定結果カード制御モジュール
 */
import { KAKIMARU_IMAGES, CIRCLED_NUMBERS } from './messages.js';
import { KanjiVGPlayer } from './kanjivg.js';

// ========================================================
// 判定結果画面（上下比較カード ＆ ミニキャンバス描画）
// ========================================================
class ResultViewController {
  constructor() {
    this.resultComparisonArea = document.getElementById('result-comparison-area');
    this.correctCardTitleEl = document.getElementById('correct-card-title');
    this.correctCharsContainer = document.getElementById('correct-chars-container');
    this.correctHintTextEl = document.getElementById('correct-hint-text');
    this.userCanvasesContainer = document.getElementById('user-canvases-container');
    this.resultLabelEl = document.getElementById('result-label');
    this.btnRestartAll = document.getElementById('btn-restart-all');
  }

  isKanji(char) {
    return /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(char);
  }

  hide() {
    if (this.resultComparisonArea) {
      this.resultComparisonArea.style.display = 'none';
    }
    if (this.resultLabelEl) {
      this.resultLabelEl.textContent = '';
    }
    if (this.btnRestartAll) {
      this.btnRestartAll.style.display = 'none';
    }
  }

  render(isAllSuccess, messageHtml, targetChars, userInputs, charResults) {
    this._renderUserCanvases(userInputs, charResults);
    this._renderCorrectChars(targetChars, isAllSuccess);

    this.resultLabelEl.innerHTML = messageHtml;
    this.resultLabelEl.className = 'result-label ' + (isAllSuccess ? 'success' : 'mistake');
    this.btnRestartAll.style.display = isAllSuccess ? 'none' : 'inline-block';

    if (this.resultComparisonArea) {
      this.resultComparisonArea.style.display = 'flex';
    }
  }

  _renderUserCanvases(userInputs, charResults) {
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
  }

  _renderCorrectChars(targetChars, isAllSuccess) {
    this.correctCharsContainer.innerHTML = '';
    this.correctCardTitleEl.textContent = 'せいかいの おてほん';

    if (this.correctHintTextEl) {
      const hasKanji = targetChars.some(c => this.isKanji(c));
      this.correctHintTextEl.style.display = (!isAllSuccess && hasKanji) ? 'block' : 'none';
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
  }
}

// ========================================================
// UIコントローラー本体
// ========================================================
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

    // プレビュー表示用コンテナ
    this.previewContainer = document.getElementById('realtime-preview-container');

    // 上下比較カード管理
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

  // 全問クリア画面の表示（通常クリア or かきまる勝負勝利）
  showAllClear(isChallengeMode = false, userName = '') {
    this.practiceView.style.display = 'none';
    this.allClearView.style.display = 'flex';

    const clearBadgeEl = document.querySelector('.clear-badge');
    const clearTitleEl = document.querySelector('.clear-title');
    const clearMascotImgEl = document.getElementById('clear-mascot-img');
    const clearStatusMsgEl = document.querySelector('.clear-status-msg');
    const btnRetry = document.getElementById('btn-clear-retry');
    const btnNext = document.getElementById('btn-clear-next');
    const btnMenu = document.getElementById('btn-clear-menu');

    if (isChallengeMode) {
      // ===== かきまるとの勝負 勝利演出 =====
      if (clearBadgeEl) clearBadgeEl.textContent = '🥇';
      // 児童名に「さん」を付与
      if (clearTitleEl) clearTitleEl.textContent = `${userName ? userName + 'さん の' : ''} かち！`;
      if (clearMascotImgEl) clearMascotImgEl.src = 'assets/images/kakimaru_11.png';
      // 1行のシンプルなセリフに変更
      if (clearStatusMsgEl) {
        clearStatusMsgEl.textContent = 'まいりました！つぎは まけないよ。';
      }

      // 「メニューに戻る」ボタンのみ中央に配置
      if (btnRetry) btnRetry.style.display = 'none';
      if (btnNext) btnNext.style.display = 'none';
      if (btnMenu) {
        btnMenu.style.display = 'inline-block';
        btnMenu.style.padding = '12px 32px';
        btnMenu.style.fontSize = '1.1rem';
      }
    } else {
      // ===== 通常単元 はなまる満点演出 =====
      if (clearBadgeEl) clearBadgeEl.textContent = '💮';
      if (clearTitleEl) clearTitleEl.textContent = 'はなまる まんてん！';
      if (clearMascotImgEl) clearMascotImgEl.src = 'assets/images/kakimaru_09.png';
      if (clearStatusMsgEl) {
        clearStatusMsgEl.textContent = 'ぜんもん せいかい！さいごまで よくがんばったね！💮';
      }

      // 3連ボタンを復元
      if (btnRetry) btnRetry.style.display = 'inline-block';
      if (btnNext) btnNext.style.display = 'inline-block';
      if (btnMenu) {
        btnMenu.style.display = 'inline-block';
        btnMenu.style.padding = '';
        btnMenu.style.fontSize = '';
      }
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

  renderTabs(totalCount, currentCharIndex, userInputs, onTabClick) {
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

  // ========================================================
  // リアルタイムプレビュー枠の描画・同期
  // ========================================================
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

  // ========================================================
  // 結果画面表示
  // ========================================================
  showResultView(isAllSuccess, messageHtml, targetChars, userInputs, charResults) {
    if (this.drawingContainer) {
      this.drawingContainer.style.display = 'none';
    }
    this.resultView.render(isAllSuccess, messageHtml, targetChars, userInputs, charResults);
  }
}