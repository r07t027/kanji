/**
 * drill.js
 * にがてな漢字特訓モード（3回連続正解で克服）制御モジュール
 */
import { CanvasController } from './canvas.js';
import { KanjiVGPlayer, prefetchKanjiVG } from './kanjivg.js';
import { playCorrectSound, playMistakeSound, playFanfareSound, ensureAudioUnlocked } from './audio.js';

export class DrillManager {
  constructor(options = {}) {
    this.storage = options.storage;
    this.validator = options.validator;
    this.gradeData = options.gradeData || null;
    this.onClose = options.onClose || (() => {});
    this.onProgressChange = options.onProgressChange || (() => {});

    // DOM要素の参照取得
    this.menuView = document.getElementById('menu-view');
    this.drillView = document.getElementById('drill-view');
    this.listCard = document.getElementById('drill-list-card');
    this.practiceCard = document.getElementById('drill-practice-card');
    this.gridContainer = document.getElementById('drill-grid-container');
    this.emptyMsg = document.getElementById('drill-empty-msg');
    this.badgeCountEl = document.getElementById('drill-badge-count');
    this.speechTextEl = document.querySelector('.drill-status-text');

    // お手本・画数・ロック・アクション要素
    this.modelBox = document.getElementById('drill-model-box');
    this.modelHint = document.getElementById('drill-model-hint');
    this.targetStrokeEl = document.getElementById('drill-stroke-target');
    this.currentStrokeEl = document.getElementById('drill-canvas-status');
    this.canvasBox = document.getElementById('drill-canvas-box');
    this.btnRestart = document.getElementById('btn-drill-restart');
    this.btnCheck = document.getElementById('btn-drill-check');

    // 練習中ステート
    this.currentChar = null;
    this.targetStroke = 0;
    this.successStreak = 0; // 連続正解数 (0〜3)
    this.lastClearedChar = null; // 消滅アニメーション対象の漢字

    // キャンバスコントローラー初期化 (260px)
    this.canvasController = new CanvasController(
      document.getElementById('drill-draw-canvas'),
      (strokeCount, strokesData, canUndo, canRedo) => this._onCanvasChange(strokeCount, canUndo, canRedo)
    );

    this._bindEvents();
  }

  setGradeData(gradeData) {
    this.gradeData = gradeData;
    this.updateBadgeCount();
  }

  updateBadgeCount() {
    const btnDrill = document.getElementById('btn-menu-drill');
    if (!this.storage || !btnDrill) return;

    const targets = this.storage.getDrillTargets();
    const count = targets.length;

    if (count > 0) {
      btnDrill.style.display = 'flex';
      if (this.badgeCountEl) {
        this.badgeCountEl.textContent = count;
        this.badgeCountEl.style.display = 'flex';
      }
    } else {
      btnDrill.style.display = 'none';
      if (this.badgeCountEl) {
        this.badgeCountEl.style.display = 'none';
      }
    }
  }

  open() {
    this.drillView.style.display = 'flex';
    if (this.speechTextEl) {
      this.speechTextEl.textContent = '３かい つづけて ただしく かけたら こくふくだ！ いっしょに がんばろう！';
    }
    this.showList();
  }

  close() {
    this.drillView.style.display = 'none';
    this.drillView.classList.remove('is-modal-overlay', 'is-fullscreen-practice');
    if (this.menuView) this.menuView.style.display = 'flex';
    this.updateBadgeCount();
    this.onClose();
  }

  // ① 苦手漢字一覧カード
  showList() {
    if (this.menuView) this.menuView.style.display = 'flex';

    this.drillView.classList.remove('is-fullscreen-practice');
    this.drillView.classList.add('is-modal-overlay');

    this.practiceCard.style.display = 'none';
    this.listCard.style.display = 'flex';
    this._renderGrid();
  }

  _bindEvents() {
    document.getElementById('btn-drill-close-list').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.close();
    });

    document.getElementById('btn-drill-back-list').addEventListener('click', () => {
      ensureAudioUnlocked();
      if (this.speechTextEl) {
        this.speechTextEl.textContent = '３かい つづけて ただしく かけたら こくふくだ！ いっしょに がんばろう！';
      }
      this.showList();
    });

    document.getElementById('btn-drill-undo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.undo();
    });
    document.getElementById('btn-drill-redo').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.redo();
    });
    document.getElementById('btn-drill-reset').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.canvasController.clear();
      this._updateSubmitButton(false);
      this._setFeedback('', 'info');
    });

    if (this.btnRestart) {
      this.btnRestart.addEventListener('click', () => {
        ensureAudioUnlocked();
        this._resetToBeginning();
      });
    }

    if (this.btnCheck) {
      this.btnCheck.addEventListener('click', () => {
        ensureAudioUnlocked();
        this._handleCheck();
      });
    }
  }

_renderGrid() {
    this.gridContainer.innerHTML = '';
    const targets = this.storage.getDrillTargets();

    const displayList = [...targets];
    if (this.lastClearedChar && !displayList.some(t => t.char === this.lastClearedChar)) {
      displayList.unshift({
        char: this.lastClearedChar,
        history: [true, true, true],
        isJustCleared: true
      });
    }

    if (displayList.length === 0) {
      this.gridContainer.style.display = 'none';
      this.emptyMsg.style.display = 'flex';
      return;
    }

    this.emptyMsg.style.display = 'none';
    this.gridContainer.style.display = 'grid';

    prefetchKanjiVG(displayList.map(t => t.char));

    displayList.forEach(t => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'drill-char-tile';

      const historyIcons = t.history.map(h => (h ? '◯' : '✕')).join(' ');
      const badgeText = t.isJustCleared ? 'こくふく！' : 'とっくん';
      const badgeClass = t.isJustCleared ? 'drill-tile-badge is-cleared' : 'drill-tile-badge';

      tile.innerHTML = `
        <span class="drill-tile-char">${t.char}</span>
        <span class="${badgeClass}">${badgeText}</span>
        <span class="drill-tile-history">${historyIcons}</span>
      `;

      if (t.isJustCleared) {
        tile.classList.add('is-cleared-target');

        // ① 0.8秒間そのまま表示して認識させる
        setTimeout(() => {
          // ② 1.0秒かけて文字と枠をスーッと透明化
          tile.classList.add('is-fading');

          // ③ タイルが完全に透明になった瞬間（1.0秒後）に「✨」を煌めかせる
          setTimeout(() => {
            const overlay = document.createElement('div');
            overlay.className = 'drill-sparkle-overlay';
            overlay.innerHTML = '<span class="drill-sparkle-star">✨</span>';
            tile.appendChild(overlay);

            // ④ キラキラが弾け終わった後（0.65秒後）に要素を除去して詰める
            setTimeout(() => {
              tile.remove();
              this.lastClearedChar = null;
              if (this.storage.getDrillTargets().length === 0) {
                this.gridContainer.style.display = 'none';
                this.emptyMsg.style.display = 'flex';
              }
            }, 650);

          }, 1000); // フェードアウト完了時

        }, 800);

      } else {
        tile.addEventListener('click', () => {
          ensureAudioUnlocked();
          this.startDrillForChar(t.char);
        });
      }

      this.gridContainer.appendChild(tile);
    });
  }

  // ② 1文字特訓の開始
  startDrillForChar(char) {
    if (this.menuView) this.menuView.style.display = 'none';

    this.drillView.classList.remove('is-modal-overlay');
    this.drillView.classList.add('is-fullscreen-practice');

    this.currentChar = char;
    this.successStreak = 0;
    this.targetStroke = this._lookupStrokeCount(char);

    this.targetStrokeEl.textContent = `このじは ${this.targetStroke}かく です。`;
    this.currentStrokeEl.textContent = 'いまの かくすう：0かく';

    this._updateCounterUI();
    this._resetModelToVisible();

    this.canvasController.clear();
    this._setFeedback('', 'info');
    this._setLocked(false);
    this._updateSubmitButton(false);

    this.listCard.style.display = 'none';
    this.practiceCard.style.display = 'flex';
  }

  _resetToBeginning() {
    this.successStreak = 0;
    this._updateCounterUI();
    this._resetModelToVisible();
    this.canvasController.clear();
    this.currentStrokeEl.textContent = 'いまの かくすう：0かく';
    this._setFeedback('', 'info');
    this._setLocked(false);
    this._updateSubmitButton(false);
  }

  _setLocked(locked) {
    if (this.canvasBox) {
      this.canvasBox.classList.toggle('is-locked', locked);
    }
    document.getElementById('btn-drill-undo').disabled = locked || !this.canvasController.canUndo();
    document.getElementById('btn-drill-redo').disabled = locked || !this.canvasController.canRedo();
    document.getElementById('btn-drill-reset').disabled = locked || (this.canvasController.strokeCount === 0);
  }

  _onCanvasChange(strokeCount, canUndo, canRedo) {
    document.getElementById('btn-drill-undo').disabled = !canUndo;
    document.getElementById('btn-drill-redo').disabled = !canRedo;
    document.getElementById('btn-drill-reset').disabled = (strokeCount === 0);
    this.currentStrokeEl.textContent = `いまの かくすう：${strokeCount}かく`;

    this._updateSubmitButton(strokeCount > 0);
  }

  _updateSubmitButton(enabled) {
    if (this.btnCheck) {
      this.btnCheck.disabled = !enabled;
    }
  }

  // ドットカウンタ更新（お手本の変更はここでは行わない）
  _updateCounterUI() {
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`drill-dot-${i}`);
      dot.classList.toggle('checked', i <= this.successStreak);
    }
    const remaining = 3 - this.successStreak;
    document.getElementById('drill-counter-text').textContent = remaining > 0 ? `あと ${remaining}かい！` : 'こくふく！';
  }

  // お手本を表示状態（KanjiVG）に戻す
  _resetModelToVisible() {
    this.modelBox.classList.remove('is-blind');
    this.modelBox.title = 'タッチすると かきじゅんを みられるよ';
    this.modelBox.innerHTML = '';
    new KanjiVGPlayer(this.modelBox, this.currentChar, true);
    this.modelHint.textContent = 'タッチすると かきじゅんが みられるよ';
  }

  // ★ 3回目（最終試行）で描画可能になったタイミングでお手本を「？」に切り替え
  _applyBlindModelIfNeeded() {
    if (this.successStreak === 2) {
      this.modelBox.innerHTML = '<span class="drill-blind-icon">？</span>';
      this.modelBox.classList.add('is-blind');
      this.modelBox.title = 'さいごは おてほんなしで かいてみよう！';
      this.modelHint.textContent = 'ラスト！おてほんなしで チャレンジ！';
    }
  }

  _setFeedback(text, type = 'info') {
    const msgEl = document.getElementById('drill-feedback-msg');
    if (!text) {
      msgEl.textContent = '';
      msgEl.style.visibility = 'hidden';
      return;
    }
    msgEl.innerHTML = text;
    msgEl.className = 'drill-feedback-msg ' + (type !== 'info' ? type : '');
    msgEl.style.visibility = 'visible';
  }

  _lookupStrokeCount(char) {
    if (this.gradeData && this.gradeData.sets) {
      for (const s of this.gradeData.sets) {
        for (const q of s.questions) {
          if (q.targets) {
            const matched = q.targets.find(t => t.char === char);
            if (matched && matched.strokes) {
              return matched.strokes;
            }
          }
        }
      }
    }
    return 0;
  }

  // 解答判定処理
  async _handleCheck() {
    this._updateSubmitButton(false);
    this.btnCheck.textContent = 'かくにん中...';
    this._setLocked(true);

    const inputData = this.canvasController.getData();

    const mockQuestion = {
      type: 'normal',
      targets: [{ char: this.currentChar, strokes: this.targetStroke }]
    };

    try {
      const { isAllSuccess, questionLogDetail } = await this.validator.validateQuestion(
        mockQuestion,
        [inputData]
      );

      this.btnCheck.textContent = 'こたえあわせ';

      if (isAllSuccess) {
        this.successStreak++;
        this._updateCounterUI(); // カウンタのみ更新（お手本はまだ隠さない）

        if (this.successStreak >= 3) {
          // 3回連続正解（克服完了）
          playFanfareSound();
          const clearedChar = this.currentChar;
          this.lastClearedChar = clearedChar;
          this.storage.markDrillCleared(clearedChar);
          this.onProgressChange();

          this._setFeedback('せいかい！', 'success');

          // 3秒後にモーダル一覧へ復帰
          setTimeout(() => {
            if (this.speechTextEl) {
              this.speechTextEl.textContent = `「${clearedChar}」を こくふくしたよ！このちょうしで がんばろう！`;
            }
            this.showList();
          }, 3000);

        } else {
          // 1回目・2回目の正解
          playCorrectSound();
          this._setFeedback('せいかい！', 'success');

          // 3秒間しっかり「せいかい！」と書いた字・お手本を確認させてから次へ
          setTimeout(() => {
            this.canvasController.clear();
            this.currentStrokeEl.textContent = 'いまの かくすう：0かく';
            this._setFeedback('', 'info');

            // ★ ここで初めて、3回目なら「？」へ切り替えて描画ロックを解除！
            this._applyBlindModelIfNeeded();
            this._setLocked(false);
            this._updateSubmitButton(false);
          }, 3000);
        }

      } else {
        // 不正解時
        playMistakeSound();

        let cleanFeedback = 'おしい！もういちど かくにんしよう。';
        const charDetail = (questionLogDetail && questionLogDetail.chars) ? questionLogDetail.chars[0] : null;

        if (charDetail) {
          if (charDetail.error === 'empty') {
            cleanFeedback = 'じを かいてみてね。';
          } else if (charDetail.error === 'stroke_mismatch') {
            cleanFeedback = 'かくすうが ちがうよ。';
          } else if (charDetail.error === 'char_mismatch') {
            cleanFeedback = 'ちがう じを かいているかも？';
          }
        }

        this._setFeedback(cleanFeedback, 'mistake');
        this._setLocked(true);
        this._updateSubmitButton(false);
      }

    } catch (err) {
      console.error('特訓判定エラー:', err);
      this.btnCheck.textContent = 'こたえあわせ';
      this._setLocked(false);
      this._updateSubmitButton(true);
      this._setFeedback('通信エラーが発生しました。', 'mistake');
    }
  }
}