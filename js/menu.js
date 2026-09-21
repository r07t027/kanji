/**
 * menu.js
 * メニュー画面（学年・学期タブ・単元グリッド・クリアバッジ表示）制御モジュール
 */

export class MenuManager {
  constructor(options = {}) {
    this.container = document.getElementById('set-grid-container');
    this.termTabsContainer = document.getElementById('term-tabs-container');
    this.termTabs = this.termTabsContainer 
      ? Array.from(this.termTabsContainer.querySelectorAll('.term-tab'))
      : Array.from(document.querySelectorAll('.term-tab'));
    this.gradeData = null;
    this.selectedSetId = '1学期_01';
    this.clearedSets = [];

    this.onSetSelected = options.onSetSelected || (() => {});
    this._bindEvents();
  }

  setData(gradeData, clearedSets, initialSetId = null) {
    this.gradeData = gradeData;
    this.clearedSets = this._normalizeClearedSets(clearedSets);

    // 学期タブの活性/グレーアウトを更新
    const availableTerms = this._updateTermTabsAvailability();

    // 初期学期・単元の決定
    let targetTerm = '1';
    if (initialSetId && this._isSetAvailable(initialSetId)) {
      this.selectedSetId = initialSetId;
      targetTerm = initialSetId.split('学期_')[0];
    } else {
      // 利用可能な最初の学期の第1問を選択
      targetTerm = availableTerms[0] || '1';
      const firstSet = this.gradeData?.sets?.find(s => s.id.startsWith(`${targetTerm}学期_`));
      this.selectedSetId = firstSet ? firstSet.id : '';
    }

    this._setActiveTab(targetTerm);
    this.renderGrid(targetTerm);
  }

  updateClearedSets(clearedSets) {
    this.clearedSets = this._normalizeClearedSets(clearedSets);
    const activeTab = this.termTabsContainer?.querySelector('.term-tab.active') || document.querySelector('.term-tab.active');
    this.renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  getSelectedSetId() {
    return this.selectedSetId || '';
  }

  setSelectedSetId(setId) {
    this.selectedSetId = setId;
    const term = setId.split('学期_')[0];
    this._setActiveTab(term);
    this.renderGrid(term);
  }

  _normalizeClearedSets(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return Object.keys(data);
    return [];
  }

  _isSetAvailable(setId) {
    return this.gradeData?.sets?.some(s => s.id === setId);
  }

  _bindEvents() {
    this.termTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // グレーアウト（無効）のタブは処理をスキップ
        if (tab.classList.contains('term-tab-disabled') || tab.disabled) return;

        this._setActiveTab(tab.dataset.term);
        this.renderGrid(tab.dataset.term);
      });
    });
  }

  _setActiveTab(termNum) {
    this.termTabs.forEach(t => {
      if (t.dataset.term === String(termNum)) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });
  }

  /**
   * 現在の学年データ内に存在する学期を調べ、タブの活性/グレーアウトを切り替える
   */
  _updateTermTabsAvailability() {
    if (!this.gradeData || !this.gradeData.sets) return [];

    const availableTerms = [];
    ['1', '2', '3'].forEach(term => {
      const hasSets = this.gradeData.sets.some(s => s.id.startsWith(`${term}学期_`));
      const tab = this.termTabs.find(t => t.dataset.term === term);
      
      if (tab) {
        if (hasSets) {
          tab.classList.remove('term-tab-disabled');
          tab.removeAttribute('disabled');
          availableTerms.push(term);
        } else {
          tab.classList.add('term-tab-disabled');
          tab.setAttribute('disabled', 'true');
        }
      }
    });

    return availableTerms;
  }

  render() {
    if (!this.gradeData) return;
    const activeTab = this.termTabsContainer?.querySelector('.term-tab.active') || document.querySelector('.term-tab.active') || this.termTabs[0];
    this.renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  renderGrid(termNum) {
    if (!this.container || !this.gradeData || !this.gradeData.sets) return;

    this.container.innerHTML = '';
    const prefix = `${termNum}学期_`;
    const setsInTerm = this.gradeData.sets.filter(s => s.id.startsWith(prefix));
    const clearedList = this._normalizeClearedSets(this.clearedSets);

    if (setsInTerm.length === 0) {
      this.container.innerHTML = '<div class="no-sets-msg" style="padding: 20px; color: #64748b; font-weight: 700;">もんだいが まだ ありません</div>';
      return;
    }

    setsInTerm.forEach(setObj => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-btn';
      if (setObj.id === this.selectedSetId) btn.classList.add('selected');

      const numStr = setObj.id.split('_')[1];
      btn.textContent = `その${parseInt(numStr, 10)}`;

      if (clearedList.includes(setObj.id)) {
        const badge = document.createElement('span');
        badge.className = 'set-badge-clear';
        badge.textContent = '💮';
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => {
        this.selectedSetId = setObj.id;
        document.querySelectorAll('.set-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.onSetSelected(setObj.id);
      });

      this.container.appendChild(btn);
    });
  }
}