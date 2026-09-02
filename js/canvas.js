// 手書きCanvas操作モジュール (アンドゥ・リドゥ対応)

export class CanvasController {
  constructor(canvasEl, onChangeCallback) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.onChange = onChangeCallback;

    this.strokesData = [];
    this.redoStack = [];
    this.currentStroke = [];
    this.strokeCount = 0;
    this.isDrawing = false;

    this._setupContext();
    this._bindEvents();
  }

  _setupContext() {
    this.ctx.lineWidth = 5.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#222222';
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._startDraw(e));
    this.canvas.addEventListener('mousemove', (e) => this._moveDraw(e));
    window.addEventListener('mouseup', () => this._endDraw());

    this.canvas.addEventListener('touchstart', (e) => this._startDraw(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._moveDraw(e), { passive: false });
    window.addEventListener('touchend', () => this._endDraw());
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return [clientX - rect.left, clientY - rect.top];
  }

  _startDraw(e) {
    e.preventDefault();
    this.isDrawing = true;
    const [x, y] = this._getPos(e);
    this.currentStroke = [[x, y]];
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  _moveDraw(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const [x, y] = this._getPos(e);
    this.currentStroke.push([x, y]);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
  }

  _endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentStroke.length > 0) {
      this.strokesData.push(this.currentStroke);
      this.strokeCount++;
      this.redoStack = [];
      this._notifyChange();
    }
  }

  undo() {
    if (this.strokesData.length === 0) return;
    const popped = this.strokesData.pop();
    this.redoStack.push(popped);
    this.strokeCount = this.strokesData.length;
    this.redraw();
    this._notifyChange();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const restored = this.redoStack.pop();
    this.strokesData.push(restored);
    this.strokeCount = this.strokesData.length;
    this.redraw();
    this._notifyChange();
  }

  canUndo() {
    return this.strokesData.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  _notifyChange() {
    if (this.onChange) {
      this.onChange(this.strokeCount, this.strokesData, this.canUndo(), this.canRedo());
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokeCount = 0;
    this.strokesData = [];
    this.redoStack = [];
    this._notifyChange();
  }

  loadStrokes(strokesData, strokeCount, redoStack = []) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokesData = [...strokesData];
    this.strokeCount = strokeCount;
    this.redoStack = [...redoStack];
    this.redraw();
    this._notifyChange();
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokesData.forEach(stroke => {
      if (stroke.length === 0) return;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0][0], stroke[0][1]);
      for (let i = 1; i < stroke.length; i++) {
        this.ctx.lineTo(stroke[i][0], stroke[i][1]);
      }
      this.ctx.stroke();
    });
  }

  getData() {
    return {
      strokesData: [...this.strokesData],
      strokeCount: this.strokeCount,
      redoStack: [...this.redoStack]
    };
  }
}
