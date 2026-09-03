/**
 * logger.js
 * Google Apps Script (GAS) Web API 連携モジュール (事前先読み対応)
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyaVMcWyIW9KXYQ6WvUm6MwKA2i4ZpykFZ5xrW6ehWomoy7Jkj4leCr3jKWZG5LcfGn/exec';

/**
 * 共通POSTリクエスト関数
 */
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

/**
 * 静的JSONからクラス・児童名簿をミリ秒で取得（初回0秒描画）
 */
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

/**
 * 起動時に裏側でスプレッドシートの全データを事前先読み
 */
export function prefetchAllDataAsync() {
  return callApi('prefetchAllData');
}

/**
 * 学習結果の送信（進捗サマリー更新 ＋ 詳細ログ追記）
 */
export async function saveProgressAndLogs(userId, setId, isSetCleared, mistakes, logRecords) {
  return await callApi('saveProgressAndLog', {
    userId,
    setId,
    isSetCleared,
    mistakes,
    logRecords
  });
}
