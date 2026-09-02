/**
 * logger.js
 * Google Apps Script (GAS) Web API 連携モジュール
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
      redirect: 'follow' // GASの302リダイレクトを確実に追跡
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
 * ログイン画面用: クラス名・児童名簿リストの取得
 */
export async function fetchClassAndUsers() {
  return await callApi('getClassesAndUsers');
}

/**
 * ログイン認証: PIN照合 & 進捗サマリーデータ取得
 */
export async function loginUser(userId, pin) {
  return await callApi('login', { userId, pin });
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