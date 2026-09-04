/**
 * resultView.js
 * 判定結果表示（上下比較カード・ミニキャンバス描画・KanjiVG連携）制御モジュール
 */
import { KanjiVGPlayer } from './kanjivg.js';

export class ResultViewController {
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