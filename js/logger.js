/**
 * logger.js
 * Google Apps Script (GAS) Web API 連携モジュール
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyaVMcWyIW9KXYQ6WvUm6MwKA2i4ZpykFZ5xrW6ehWomoy7Jkj4leCr3jKWZG5LcfGn/exec';

async function callApi(action, payload = {}) {
  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, payload }),
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`GAS API Error (${action}):`, err);
    return { success: false, message: `通信エラー: ${err.message}` };
  }
}

export async function fetchClassAndUsersFromLocal() {
  try {
    const res = await fetch('data/users.json');
    if (!res.ok) throw new Error('users.json not found');
    const data = await res.json();
    return { success: true, ...data };
  } catch (e) {
    console.error('users.jsonの読み込みに失敗しました:', e);
    return { success: false, classes: [], users: [] };
  }
}

export function prefetchAllDataAsync() {
  return callApi('prefetchAllData');
}

export async function updateHandModeApi(userId, handMode) {
  return await callApi('updateHandMode', { userId, handMode });
}

export async function updateSoundModeApi(userId, soundMode) {
  return await callApi('updateSoundMode', { userId, soundMode });
}

export async function updatePinApi(userId, newPin) {
  return await callApi('updatePin', { userId, newPin });
}

/**
 * clearedSets のオブジェクト正規化ヘルパー
 * スプレッドシートB列の型破壊（オブジェクト文字列化や配列混入）を防止
 */
function normalizeClearedSetsPayload(clearedSets) {
  if (!clearedSets) return {};
  if (Array.isArray(clearedSets)) {
    const obj = {};
    clearedSets.forEach(id => {
      obj[id] = new Date().toISOString();
    });
    return obj;
  }
  if (typeof clearedSets === 'object') {
    return clearedSets;
  }
  return {};
}

/**
 * 学習完了時の保存（MASTER進捗マージ ＋ LOG追記）
 */
export async function saveProgressAndLogs(userId, setId, isSetCleared, charStats, logRecords) {
  return await callApi('saveProgressAndLog', {
    userId,
    setId,
    isSetCleared,
    charStats: (charStats && typeof charStats === 'object') ? charStats : {},
    logRecords: Array.isArray(logRecords) ? logRecords : []
  });
}

/**
 * バックグラウンド進捗同期（安全ガード付き）
 */
export async function syncProgressSilently(userId, clearedSets, charStats) {
  try {
    const safeClearedSets = normalizeClearedSetsPayload(clearedSets);
    const safeCharStats = (charStats && typeof charStats === 'object') ? charStats : {};

    fetch(GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      redirect: 'follow',
      keepalive: true,
      body: JSON.stringify({
        action: 'updateProgress',
        payload: {
          userId,
          clearedSets: safeClearedSets,
          charStats: safeCharStats
        }
      })
    }).catch(err => console.warn('バックグラウンド同期エラー:', err));
  } catch (e) {
    console.warn('同期呼び出し例外:', e);
  }
}