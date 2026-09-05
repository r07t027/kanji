/**
 * menu.js
 * メニュー画面（学年・学期タブ・単元グリッド・クリアバッジ表示）制御モジュール
 */

export class MenuManager {
  constructor(options = {}) {
    this.container = document.getElementById('set-grid-container');
    this.termTabs = document.querySelectorAll('.term-tab:not(.term-tab-disabled)');
    this.gradeData = null;
    this.selectedSetId = '1学期_01';
    this.clearedSets = [];

    this.onSetSelected = options.onSetSelected || (() => {});
    this._bindEvents();
  }

  setData(gradeData, clearedSets, initialSetId = '1学期_01') {
    this.gradeData = gradeData;
    this.clearedSets = this._normalizeClearedSets(clearedSets);
    this.selectedSetId = initialSetId;
    this.render();
  }

  updateClearedSets(clearedSets) {
    this.clearedSets = this._normalizeClearedSets(clearedSets);
    const activeTab = document.querySelector('.term-tab.active');
    this.renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  getSelectedSetId() {
    return this.selectedSetId || '1学期_01';
  }

  setSelectedSetId(setId) {
    this.selectedSetId = setId;
    const activeTab = document.querySelector('.term-tab.active');
    this.renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  _normalizeClearedSets(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return Object.keys(data);
    return [];
  }

  _bindEvents() {
    this.termTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.termTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.renderGrid(tab.dataset.term);
      });
    });
  }

  render() {
    if (!this.gradeData) return;
    const activeTab = document.querySelector('.term-tab.active') || this.termTabs[0];
    this.renderGrid(activeTab ? activeTab.dataset.term : '1');
  }

  renderGrid(termNum) {
    if (!this.container || !this.gradeData || !this.gradeData.sets) return;

    this.container.innerHTML = '';
    const prefix = `${termNum}学期_`;
    const setsInTerm = this.gradeData.sets.filter(s => s.id.startsWith(prefix));
    const clearedList = this._normalizeClearedSets(this.clearedSets);

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