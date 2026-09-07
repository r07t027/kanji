/**
 * drill.js
 * にがてな漢字特訓モード（3回連続正解で克服）制御モジュール
 */
import { CanvasController } from './canvas.js';
import { KanjiVGPlayer, prefetchKanjiVG } from './kanjivg.js';
import { playCorrectSound, playMistakeSound, playFanfareSound, playDisappearSound, ensureAudioUnlocked } from './audio.js';
import { syncProgressSilently } from './logger.js';

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
    this.lastClearedChar = null; // 直前に克服した文字
    this.isLocked = false;

    // 今回の特訓セット（最大6文字）のスナップショット
    this.currentBatchList = [];

    // キャンバスコントローラー初期化 (260px)
    this.canvasController = new CanvasController(
      document.getElementById('drill-draw-canvas'),
      (strokeCount, strokesData, canUndo, canRedo) => this._onCanvasChange(strokeCount, canUndo, canRedo)
    );

    // キーボードショートカット
    this.canvasController.initKeyboardShortcuts(() => {
      if (this.isLocked) return;
      ensureAudioUnlocked();
    });

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

  // 優先度ソート（直近3連続✕を最優先）
  _getSortedTargets() {
    const targets = this.storage.getDrillTargets();
    return targets.sort((a, b) => {
      const aHistory = a.history || [];
      const bHistory = b.history || [];

      // 直近の連続不正解数（末尾からの連続false数）
      const getConsecutiveMistakes = (hist) => {
        let count = 0;
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i] === false) count++;
          else break;
        }
        return count;
      };

      const aMistakes = getConsecutiveMistakes(aHistory);
      const bMistakes = getConsecutiveMistakes(bHistory);

      if (bMistakes !== aMistakes) {
        return bMistakes - aMistakes;
      }

      const aFalseCount = aHistory.filter(h => h === false).length;
      const bFalseCount = bHistory.filter(h => h === false).length;
      return bFalseCount - aFalseCount;
    });
  }

  // メニューから特訓を開いたとき
  open() {
    this.drillView.style.display = 'flex';
    if (this.speechTextEl) {
      this.speechTextEl.textContent = '３かい つづけて ただしく かけたら こくふくだ！ いっしょに がんばろう！';
    }

    // 優先度上位6文字を今回のバッチとして固定
    const sorted = this._getSortedTargets();
    this.currentBatchList = sorted.slice(0, 6).map(t => t.char);

    this.showList();
  }

  close() {
    this.drillView.style.display = 'none';
    this.drillView.classList.remove('is-modal-overlay', 'is-fullscreen-practice');
    if (this.menuView) this.menuView.style.display = 'flex';
    this.currentBatchList = [];
    this.updateBadgeCount();
    this.onClose();
  }

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
      if (this.isLocked) return;
      ensureAudioUnlocked();
      this.canvasController.undo();
    });
    document.getElementById('btn-drill-redo').addEventListener('click', () => {
      if (this.isLocked) return;
      ensureAudioUnlocked();
      this.canvasController.redo();
    });
    document.getElementById('btn-drill-reset').addEventListener('click', () => {
      if (this.isLocked) return;
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

    // 現在のストレージ上の苦手漢字を取得
    const currentTargets = this.storage.getDrillTargets();
    const targetCharSet = new Set(currentTargets.map(t => t.char));

    // バッチ内の文字で、まだ未克服の文字のみを抽出（直前にクリアした文字はエフェクト用に含める）
    const displayChars = this.currentBatchList.filter(char => {
      return targetCharSet.has(char) || char === this.lastClearedChar;
    });

    // バッチ内の文字が0件になった場合の初期ガード
    if (displayChars.length === 0) {
      const nextTargets = this._getSortedTargets();
      if (nextTargets.length > 0) {
        if (this.speechTextEl) {
          this.speechTextEl.textContent = 'いいちょうし！ さらに とっくんを つづけよう！';
        }
        this.currentBatchList = nextTargets.slice(0, 6).map(t => t.char);
        this._renderGrid();
        return;
      } else {
        this.gridContainer.style.display = 'none';
        this.emptyMsg.style.display = 'flex';
        return;
      }
    }

    this.emptyMsg.style.display = 'none';
    this.gridContainer.style.display = 'grid';

    prefetchKanjiVG(displayChars);

    displayChars.forEach(char => {
      const isJustCleared = (char === this.lastClearedChar);

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'drill-char-tile';

      const badgeText = isJustCleared ? 'こくふく！' : 'とっくんする';
      const badgeClass = isJustCleared ? 'drill-tile-badge is-cleared' : 'drill-tile-badge';

      tile.innerHTML = `
        <span class="drill-tile-char">${char}</span>
        <span class="${badgeClass}">${badgeText}</span>
      `;

      if (isJustCleared) {
        tile.classList.add('is-cleared-target');
        tile.style.cursor = 'default';

        setTimeout(() => {
          tile.classList.add('is-fading-out');

          tile.addEventListener('animationend', () => {
            const rect = tile.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const sparkle = document.createElement('div');
            sparkle.className = 'drill-floating-sparkle';
            sparkle.textContent = '✨';
            sparkle.style.left = `${centerX}px`;
            sparkle.style.top = `${centerY}px`;
            document.body.appendChild(sparkle);

            playDisappearSound();

            sparkle.addEventListener('animationend', () => {
              sparkle.remove();
              tile.remove();

              // バッチから克服した文字を除去
              const cleared = this.lastClearedChar;
              this.currentBatchList = this.currentBatchList.filter(c => c !== cleared);
              this.lastClearedChar = null;

              // ★ 1セット（バッチ内）の文字が全て消滅した瞬間の次セット展開処理
              if (this.currentBatchList.length === 0) {
                const nextTargets = this._getSortedTargets();

                if (nextTargets.length > 0) {
                  // ① まだ苦手漢字が残っている場合：励ましメッセージと共に次の6文字を展開
                  if (this.speechTextEl) {
                    this.speechTextEl.textContent = 'いいちょうし！ さらに とっくんを つづけよう！';
                  }
                  this.currentBatchList = nextTargets.slice(0, 6).map(t => t.char);
                  this._renderGrid();
                } else {
                  // ② 全ての苦手漢字がなくなった場合：空メッセージを表示
                  if (this.speechTextEl) {
                    this.speechTextEl.textContent = 'ぜんぶ ばっちり！このちょうしで がんばろう！';
                  }
                  this.gridContainer.style.display = 'none';
                  this.emptyMsg.style.display = 'flex';
                }
              }
            }, { once: true });

          }, { once: true });

        }, 1200);

      } else {
        tile.addEventListener('click', () => {
          ensureAudioUnlocked();
          this.startDrillForChar(char);
        });
      }

      this.gridContainer.appendChild(tile);
    });
  }

  // 1文字特訓の開始
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
    this.isLocked = locked;
    if (this.canvasController) {
      this.canvasController.setLocked(locked);
    }
    if (this.canvasBox) {
      this.canvasBox.classList.toggle('is-locked', locked);
    }
    document.getElementById('btn-drill-undo').disabled = locked || !this.canvasController.canUndo();
    document.getElementById('btn-drill-redo').disabled = locked || !this.canvasController.canRedo();
    document.getElementById('btn-drill-reset').disabled = locked || (this.canvasController.strokeCount === 0);
  }

  _onCanvasChange(strokeCount, canUndo, canRedo) {
    if (this.isLocked) return;
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

  _updateCounterUI() {
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`drill-dot-${i}`);
      dot.classList.toggle('checked', i <= this.successStreak);
    }
    const remaining = 3 - this.successStreak;
    document.getElementById('drill-counter-text').textContent = remaining > 0 ? `あと ${remaining}かい！` : 'こくふく！';
  }

  _resetModelToVisible() {
    this.modelBox.classList.remove('is-blind');
    this.modelBox.title = 'タッチすると かきじゅんを みられるよ';
    this.modelBox.innerHTML = '';
    new KanjiVGPlayer(this.modelBox, this.currentChar, true);
    this.modelHint.textContent = 'タッチすると かきじゅんが みられるよ';
  }

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
        this._updateCounterUI();

        if (this.successStreak >= 3) {
          // 3回連続正解（克服完了）
          playFanfareSound();
          const clearedChar = this.currentChar;
          this.lastClearedChar = clearedChar;
          this.storage.markDrillCleared(clearedChar);
          this.onProgressChange();

          // スプレッドシートへ即時同期
          const currentUser = this.storage.getCurrentUser();
          if (currentUser) {
            const progress = this.storage.getProgress();
            syncProgressSilently(currentUser.userId, progress.clearedSets, progress.charStats);
          }

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

          setTimeout(() => {
            this.canvasController.clear();
            this.currentStrokeEl.textContent = 'いまの かくすう：0かく';
            this._setFeedback('', 'info');

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