// Web Audio API による MP3 プリロード & 低遅延再生
let audioCtx = null;
const audioBuffers = {};
let isMuted = false;
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
    if (!response.ok) return;
    const arrayBuffer = await response.arrayBuffer();
    const ctx = getAudioContext();
    if (!ctx) return;
    // コールバック形式とPromise形式の両対応で確実にデコード
    return new Promise((resolve) => {
      ctx.decodeAudioData(
        arrayBuffer,
        (decoded) => {
          audioBuffers[name] = decoded;
          resolve();
        },
        (err) => {
          console.warn(`デコード失敗 (${name}):`, err);
          resolve();
        }
      );
    });
  } catch (err) {
    console.warn(`音声読み込み失敗 (${name}):`, err);
  }
}

export function ensureAudioUnlocked() {
  if (isMuted) return;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function initAudioUnlock() {
  const unlock = async () => {
    if (isUnlocked) return;
    isUnlocked = true;

    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {}
    }

    // ダミー音声でiOS/WebKitの制限を解除
    if (ctx) {
      try {
        const dummy = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = dummy;
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) {}
    }

    // アンロックされた安全な状態で全音声をデコード読み込み
    Object.entries(SOUND_FILES).forEach(([name, url]) => {
      if (!audioBuffers[name]) {
        loadSound(name, url);
      }
    });

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