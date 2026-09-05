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
    this.drillView = document.getElementById('drill-view');
    this.listCard = document.getElementById('drill-list-card');
    this.practiceCard = document.getElementById('drill-practice-card');
    this.gridContainer = document.getElementById('drill-grid-container');
    this.emptyMsg = document.getElementById('drill-empty-msg');
    this.badgeCountEl = document.getElementById('drill-badge-count');

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

  // メニュー画面のバッジ件数を更新
  updateBadgeCount() {
    if (!this.badgeCountEl || !this.storage) return;
    const targets = this.storage.getDrillTargets();
    const count = targets.length;

    if (count > 0) {
      this.badgeCountEl.textContent = count;
      this.badgeCountEl.style.display = 'inline-block';
    } else {
      this.badgeCountEl.style.display = 'none';
    }
  }

  // 特訓画面を開く（一覧表示）
  open() {
    this.drillView.style.display = 'flex';
    this.showList();
  }

  // 特訓画面を閉じる
  close() {
    this.drillView.style.display = 'none';
    this.updateBadgeCount();
    this.onClose();
  }

  showList() {
    this.practiceCard.style.display = 'none';
    this.listCard.style.display = 'flex';
    this._renderGrid();
  }

  _bindEvents() {
    // メニューへ戻るボタン
    document.getElementById('btn-drill-close-list').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.close();
    });

    // 一覧へ戻るボタン
    document.getElementById('btn-drill-back-list').addEventListener('click', () => {
      ensureAudioUnlocked();
      this.showList();
    });

    // 描画操作ボタン
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

    // こたえあわせボタン
    document.getElementById('btn-drill-check').addEventListener('click', () => {
      ensureAudioUnlocked();
      this._handleCheck();
    });
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

    // 漢字一覧の事前KanjiVGフェッチ
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

  // 1文字特訓の開始
  startDrillForChar(char) {
    this.currentChar = char;
    this.successStreak = 0;
    this.targetStroke = this._lookupStrokeCount(char);

    // DOM更新
    document.getElementById('drill-target-char-display').textContent = char;
    document.getElementById('drill-stroke-target').textContent = `もくひょう：${this.targetStroke}かく`;
    this._updateStreakUI();

    // お手本SVGの描画
    const modelBox = document.getElementById('drill-model-box');
    modelBox.innerHTML = '';
    new KanjiVGPlayer(modelBox, char, true);

    // キャンバスリセット
    this.canvasController.clear();
    this._setFeedback('１かく１かく ていねいに かこう！', 'info');
    this._updateSubmitButton(false);

    // カード切り替え
    this.listCard.style.display = 'none';
    this.practiceCard.style.display = 'flex';
  }

  _onCanvasChange(strokeCount, canUndo, canRedo) {
    document.getElementById('btn-drill-undo').disabled = !canUndo;
    document.getElementById('btn-drill-redo').disabled = !canRedo;
    document.getElementById('btn-drill-reset').disabled = (strokeCount === 0);
    document.getElementById('drill-canvas-status').textContent = `いまの かくすう：${strokeCount}かく`;

    this._updateSubmitButton(strokeCount > 0);
  }

  _updateSubmitButton(enabled) {
    const btn = document.getElementById('btn-drill-check');
    btn.disabled = !enabled;
  }

  _updateStreakUI() {
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`drill-dot-${i}`);
      dot.classList.toggle('checked', i <= this.successStreak);
    }
    const remaining = 3 - this.successStreak;
    document.getElementById('drill-counter-text').textContent = remaining > 0 ? `あと ${remaining}かい！` : 'こくふく！💮';
  }

  _setFeedback(text, type = 'info') {
    const msgEl = document.getElementById('drill-feedback-msg');
    msgEl.innerHTML = text;
    msgEl.className = 'drill-feedback-msg ' + (type !== 'info' ? type : '');
    msgEl.style.display = text ? 'block' : 'none';
  }

  // 問題データから該当漢字の画数を検索（フォールバック付き）
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

  // 解答判定
  async _handleCheck() {
    const btn = document.getElementById('btn-drill-check');
    btn.disabled = true;
    btn.textContent = 'かくにん中...';

    const inputData = this.canvasController.getData();

    // 既存 validator.js に適合するダミー問題オブジェクトを作成
    const mockQuestion = {
      type: 'normal',
      targets: [{ char: this.currentChar, strokes: this.targetStroke }]
    };

    try {
      const { isAllSuccess, feedbackHtml } = await this.validator.validateQuestion(
        mockQuestion,
        [inputData]
      );

      btn.textContent = 'こたえあわせ';

      if (isAllSuccess) {
        this.successStreak++;
        this._updateStreakUI();

        if (this.successStreak >= 3) {
          // ★ 3回連続正解：特訓完了！
          playFanfareSound();
          this.storage.markDrillCleared(this.currentChar);
          this.onProgressChange(); // 変更通知（裏同期フラグON）

          this._setFeedback('🎉 ３かい れんぞく せいかい！こくふく かんりょう！', 'success');

          setTimeout(() => {
            alert(`「${this.currentChar}」をとっくんしたよ！このちょうしで がんばろう！`);
            this.showList();
          }, 1200);

        } else {
          playCorrectSound();
          this._setFeedback(`ばっちり！せいかい！（あと ${3 - this.successStreak}かい）`, 'success');
          setTimeout(() => {
            this.canvasController.clear();
            this._setFeedback('もういちど かいてみよう！', 'info');
          }, 1000);
        }

      } else {
        playMistakeSound();
        this.successStreak = 0; // 失敗時はカウントリセット
        this._updateStreakUI();
        this._setFeedback(feedbackHtml || 'おしい！おてほんを タッチして かきじゅんを たしかめよう。', 'mistake');
        btn.disabled = false;
      }

    } catch (err) {
      console.error('特訓判定エラー:', err);
      btn.textContent = 'こたえあわせ';
      btn.disabled = false;
      this._setFeedback('通信エラーが発生しました。', 'mistake');
    }
  }
}