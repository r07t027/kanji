// Web Audio API による MP3 プリロード & 低遅延再生
let audioCtx = null;
const audioBuffers = {};

const SOUND_FILES = {
  correct: 'assets/audio/correct.mp3',
  wrong: 'assets/audio/wrong.mp3',
  complete: 'assets/audio/complete.mp3'
};

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

async function loadSound(name, url) {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = getAudioContext();
    audioBuffers[name] = await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn(`音声ファイルの読み込み/デコードに失敗しました (${name}):`, err);
  }
}

export function ensureAudioUnlocked() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume();
  }
}

export function initAudioUnlock() {
  let isUnlocked = false;

  const unlock = async () => {
    if (isUnlocked) return;
    isUnlocked = true;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const dummyBuffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = dummyBuffer;
    source.connect(ctx.destination);
    source.start(0);

    await Promise.all(
      Object.entries(SOUND_FILES).map(([name, url]) => loadSound(name, url))
    );

    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchstart', unlock);
  window.addEventListener('keydown', unlock);
}

function playBuffer(name) {
  const ctx = getAudioContext();
  if (!ctx || !audioBuffers[name]) return;

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffers[name];
  source.connect(ctx.destination);
  source.start(0);
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
