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

  // 特訓画面を開く（メニューの上に半透明オーバーレイ表示）
  open() {
    this.drillView.style.display = 'flex';
    this.showList();
  }

  // 特訓画面を閉じ、メニュー画面を再表示
  close() {
    this.drillView.style.display = 'none';
    this.drillView.classList.remove('is-modal-overlay', 'is-fullscreen-practice');
    if (this.menuView) this.menuView.style.display = 'flex';
    this.updateBadgeCount();
    this.onClose();
  }

  // ① 苦手漢字一覧カード（メニューを背面に残したオーバーレイモーダル）
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

    // 「はじめから」ボタン押下時（ここで初めてカウントをリセットして再開）
    if (this.btnRestart) {
      this.btnRestart.addEventListener('click', () => {
        ensureAudioUnlocked();
        this._resetToBeginning();
      });
    }

    // 「こたえあわせ」ボタン押下時
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

    if (targets.length === 0) {
      this.gridContainer.style.display = 'none';
      this.emptyMsg.style.display = 'flex';
      return;
    }

    this.emptyMsg.style.display = 'none';
    this.gridContainer.style.display = 'grid';

    prefetchKanjiVG(targets.map(t => t.char));

    targets.forEach(t => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'drill-char-tile';

      const historyIcons = t.history.map(h => (h ? '◯' : '✕')).join(' ');

      tile.innerHTML = `
        <span class="drill-tile-char">${t.char}</span>
        <span class="drill-tile-badge">とっくん</span>
        <span class="drill-tile-history">${historyIcons}</span>
      `;

      tile.addEventListener('click', () => {
        ensureAudioUnlocked();
        this.startDrillForChar(t.char);
      });

      this.gridContainer.appendChild(tile);
    });
  }

  // ② 1文字特訓の開始（メニューを完全に隠して1画面専用ビューへ）
  startDrillForChar(char) {
    if (this.menuView) this.menuView.style.display = 'none';

    this.drillView.classList.remove('is-modal-overlay');
    this.drillView.classList.add('is-fullscreen-practice');

    this.currentChar = char;
    this.successStreak = 0;
    this.targetStroke = this._lookupStrokeCount(char);

    this.targetStrokeEl.textContent = `このじは ${this.targetStroke}かく です。`;
    this.currentStrokeEl.textContent = 'いまの かくすう：0かく';

    this._updateStreakAndModelUI();

    this.canvasController.clear();
    this._setFeedback('', 'info');
    this._setLocked(false);
    this._updateSubmitButton(false);

    this.listCard.style.display = 'none';
    this.practiceCard.style.display = 'flex';
  }

  // 「はじめから」ボタン押下によるリスタート処理
  _resetToBeginning() {
    this.successStreak = 0;
    this._updateStreakAndModelUI();
    this.canvasController.clear();
    this.currentStrokeEl.textContent = 'いまの かくすう：0かく';
    this._setFeedback('', 'info');
    this._setLocked(false); // ロック解除して最初から書けるようにする
    this._updateSubmitButton(false);
  }

  // 描画および操作ボタンのロック/アンロック制御
  _setLocked(locked) {
    if (this.canvasBox) {
      this.canvasBox.classList.toggle('is-locked', locked);
    }
    document.getElementById('btn-drill-undo').disabled = locked || !this.canvasController.canUndo();
    document.getElementById('btn-drill-redo').disabled = locked || !this.canvasController.canRedo();
    document.getElementById('btn-drill-reset').disabled = locked || (this.canvasController.strokeCount === 0);
    // 「はじめから」ボタンは常に操作可能（locked の影響を受けない）
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

  // 連続正解数に応じてお手本とお知らせを出し分け（3回目はブラインド）
  _updateStreakAndModelUI() {
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`drill-dot-${i}`);
      dot.classList.toggle('checked', i <= this.successStreak);
    }
    const remaining = 3 - this.successStreak;
    document.getElementById('drill-counter-text').textContent = remaining > 0 ? `あと ${remaining}かい！` : 'こくふく！💮';

    // 3回目（過去2回正解・あと1回）はお手本を隠して自力テスト
    if (this.successStreak === 2) {
      this.modelBox.innerHTML = '<span class="drill-blind-icon">？</span>';
      this.modelBox.classList.add('is-blind');
      this.modelBox.title = 'さいごは おてほんなしで かいてみよう！';
      this.modelHint.textContent = 'ラスト！おてほんなしで チャレンジ！';
    } else {
      this.modelBox.classList.remove('is-blind');
      this.modelBox.title = 'タッチすると かきじゅんを みられるよ';
      this.modelBox.innerHTML = '';
      new KanjiVGPlayer(this.modelBox, this.currentChar, true);
      this.modelHint.textContent = 'タッチすると かきじゅんが みられるよ';
    }
  }

  // メッセージ表示（高さを維持したまま visibility を制御）
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
    this._setLocked(true); // 判定開始とともにキャンバス操作を完全にロック

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
        this._updateStreakAndModelUI();

        if (this.successStreak >= 3) {
          // 3回連続正解（克服完了）
          playFanfareSound();
          this.storage.markDrillCleared(this.currentChar);
          this.onProgressChange();

          this._setFeedback('せいかい！💮 こくふく かんりょう！', 'success');

          setTimeout(() => {
            alert(`「${this.currentChar}」をとっくんしたよ！このちょうしで がんばろう！`);
            this.showList();
          }, 1500);

        } else {
          // 1回目・2回目の正解：3秒間ロックを維持して余韻を表示
          playCorrectSound();
          this._setFeedback('せいかい！', 'success');

          setTimeout(() => {
            this.canvasController.clear();
            this.currentStrokeEl.textContent = 'いまの かくすう：0かく';
            this._setFeedback('', 'info');
            this._setLocked(false); // 次の描画のためにロック解除
            this._updateSubmitButton(false);
          }, 3000);
        }

      } else {
        // ★ 不正解時：カウンタはリセットせずそのまま保持
        playMistakeSound();

        // メッセージをシンプルかつひらがなベースに最適化
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

        // ★ キャンバスと「こたえあわせ」ボタンはロックしたまま維持（「はじめから」ボタンのみ受付）
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