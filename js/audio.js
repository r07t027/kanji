// Web Audio API による MP3 プリロード & 低遅延再生
let audioCtx = null;
const audioBuffers = {};
let isMuted = false;
let isPreloading = false;
let isUnlocked = false;

const SOUND_FILES = {
  correct: 'assets/audio/correct.mp3',
  wrong: 'assets/audio/wrong.mp3',
  complete: 'assets/audio/complete.mp3',
  disappear: 'assets/audio/disappear.mp3',
  drill: 'assets/audio/drill.mp3'
};

export function setAudioMuted(muted) {
  isMuted = !!muted;
}

export function isAudioMuted() {
  return isMuted;
}

export function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

async function loadSound(name, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = getAudioContext();
    if (!ctx) return;
    audioBuffers[name] = await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn(`音声ファイルの読み込み/デコードに失敗しました (${name}):`, err);
  }
}

/**
 * 起動直後に全音声ファイルを即座にプリロード開始する関数
 */
export async function preloadAllSounds() {
  if (isPreloading) return;
  isPreloading = true;
  getAudioContext(); // コンテキストを先行生成
  await Promise.allSettled(
    Object.entries(SOUND_FILES).map(([name, url]) => loadSound(name, url))
  );
}

export function ensureAudioUnlocked() {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function initAudioUnlock() {
  // 1. 音声データの読み込みはユーザー操作を待たずに即時バックグラウンドで開始
  preloadAllSounds();

  // 2. ユーザーの初回操作で確実に AudioContext をアンロック
  const unlock = async () => {
    if (isUnlocked) return;
    const ctx = getAudioContext();

    if (ctx) {
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (e) {}
      }

      // 無音バッファを再生して iOS / Chrome の制限を解除
      try {
        const dummyBuffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = dummyBuffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (e) {}
    }

    isUnlocked = true;

    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

function playBuffer(name) {
  if (isMuted) return;

  const ctx = getAudioContext();
  if (!ctx || !audioBuffers[name]) return;

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      _executePlay(ctx, audioBuffers[name]);
    }).catch(() => {});
    return;
  }

  _executePlay(ctx, audioBuffers[name]);
}

function _executePlay(ctx, buffer) {
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn('音声再生エラー:', err);
  }
}

export function playCorrectSound() {
  playBuffer('correct');
}

export function playFanfareSound() {
  playBuffer('complete');
}

export function playMistakeSound() {
  playBuffer('wrong');
}

export function playDisappearSound() {
  playBuffer('disappear');
}

export function playDrillSound() {
  playBuffer('drill');
}