/**
 * logger.js
 * Google Apps Script (GAS) Web API との通信モジュール
 */

// ★お使いのデプロイ済みGAS WebアプリURL
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyaVMcWyIW9KXYQ6WvUm6MwKA2i4ZpykFZ5xrW6ehWomoy7Jkj4leCr3jKWZG5LcfGn/exec';

/**
 * GAS向けPOSTヘルパー（CORSプリフライト回避・リダイレクト追従）
 */
async function postToGas(bodyObj) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(bodyObj)
  });
  return await res.json();
}

/**
 * 静的名簿JSON（data/users.json）の読み込み
 */
export async function fetchClassAndUsersFromLocal() {
  try {
    const res = await fetch('data/users.json');
    if (!res.ok) throw new Error('users.json の読み込みに失敗しました');
    const data = await res.json();
    return {
      success: true,
      classes: data.classes || [],
      users: data.users || []
    };
  } catch (e) {
    console.error('ローカル名簿の取得に失敗:', e);
    return { success: false, error: e };
  }
}

/**
 * 全認証データ ＆ 全進捗データを一括取得 (Prefetch)
 */
export async function prefetchAllDataAsync() {
  try {
    return await postToGas({ action: 'prefetchAllData' });
  } catch (e) {
    console.warn('GAS事前データ取得に失敗:', e);
    return { success: false, error: e };
  }
}

/**
 * 通常単元クリア時の進捗 ＆ ログ一括保存
 */
export async function saveProgressAndLogs(userId, setId, isSetCleared, charStats, sessionLogs) {
  try {
    return await postToGas({
      action: 'saveProgressAndLog',
      payload: {
        userId: userId,
        setId: setId,
        isSetCleared: isSetCleared,
        charStats: charStats,
        logRecords: sessionLogs
      }
    });
  } catch (e) {
    console.warn('進捗ログ保存に失敗:', e);
    return { success: false, error: e };
  }
}

/**
 * 「もどる」ボタン押下時などのバックグラウンド軽量進捗同期
 */
export async function syncProgressSilently(userId, clearedSets, charStats) {
  try {
    fetch(GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      keepalive: true,
      body: JSON.stringify({
        action: 'updateProgress',
        payload: {
          userId: userId,
          clearedSets: clearedSets,
          charStats: charStats
        }
      })
    }).catch(err => console.warn('バックグラウンド同期エラー:', err));
  } catch (e) {
    console.warn('同期呼び出し例外:', e);
  }
}

/**
 * きき手設定の保存API
 */
export async function updateHandModeApi(userId, handMode) {
  try {
    return await postToGas({
      action: 'updateHandMode',
      payload: {
        userId: userId,
        handMode: handMode
      }
    });
  } catch (e) {
    return { success: false, error: e };
  }
}

/**
 * PINコード変更API
 */
export async function updatePinApi(userId, newPin) {
  try {
    return await postToGas({
      action: 'updatePin',
      payload: {
        userId: userId,
        newPin: newPin
      }
    });
  } catch (e) {
    return { success: false, error: e };
  }
}