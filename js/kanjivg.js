// 日本の文科省筆順・KanjiVG SVG 描画モジュール
// 静止画表示 ＆ クリック時アニメーション再生

export class KanjiVGPlayer {
  constructor(containerEl, char, isInteractive = true) {
    this.container = containerEl;
    this.char = char;
    this.isInteractive = isInteractive;
    this.paths = [];
    this.animationTimer = null;
    this.isAnimating = false;
    this.init();
  }

  async init() {
    const hex = this.char.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/${hex}.svg`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('SVG not found');
      const svgText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');

      if (!svgEl) throw new Error('Invalid SVG');

      svgEl.setAttribute('class', 'kanji-stroke-svg');
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.setAttribute('viewBox', '0 0 109 109');

      const textGroup = svgEl.querySelector('g[id^="kvg:StrokeNumbers"]');
      if (textGroup) textGroup.style.display = 'none';

      this.paths = Array.from(svgEl.querySelectorAll('path')).filter(p => p.id && p.id.includes('-s'));

      this.paths.forEach(path => {
        path.style.stroke = '#00695c';
        path.style.strokeWidth = '4.5px';
        path.style.strokeLinecap = 'round';
        path.style.strokeLinejoin = 'round';
        path.style.fill = 'none';
        path.style.opacity = '1';
      });

      this.container.innerHTML = '';
      this.container.appendChild(svgEl);

      if (this.isInteractive) {
        this.container.classList.add('interactive');
        this.container.title = `クリックまたはタップで「${this.char}」の筆順を再生`;

        this.container.addEventListener('click', () => this.play());
        this.container.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.play();
        }, { passive: false });
      }

    } catch (err) {
      console.warn(`KanjiVG load failed for ${this.char}:`, err);
      this.container.innerHTML = `<span class="correct-kana-text">${this.char}</span>`;
    }
  }

  play() {
    if (!this.paths || this.paths.length === 0 || this.isAnimating) return;
    this.isAnimating = true;

    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
    }

    this.paths.forEach(path => {
      const len = path.getTotalLength();
      path.style.transition = 'none';
      path.style.strokeDasharray = `${len} ${len}`;
      path.style.strokeDashoffset = len;
      path.style.opacity = '0';
    });

    let currentStroke = 0;

    const animateNext = () => {
      if (currentStroke >= this.paths.length) {
        setTimeout(() => {
          this.paths.forEach(path => {
            path.style.transition = 'none';
            path.style.strokeDasharray = 'none';
            path.style.strokeDashoffset = '0';
            path.style.opacity = '1';
          });
          this.isAnimating = false;
        }, 300);
        return;
      }

      const path = this.paths[currentStroke];
      const len = path.getTotalLength();
      path.style.opacity = '1';
      path.style.transition = 'stroke-dashoffset 0.35s ease-in-out';
      path.style.strokeDashoffset = '0';

      currentStroke++;
      this.animationTimer = setTimeout(animateNext, 380);
    };

    this.animationTimer = setTimeout(animateNext, 60);
  }
}
