```markdown
# 📖 漢字練習Webアプリ「かきトレ」システム設計・保守・データ定義完全ガイド（HANDOVER v8）

## 1. アプリケーション概要と基本方針

本プロジェクトは、小学校児童向けのタブレット（Chromebook / iPad 等）およびPC環境に最適化された **漢字手書き練習Webアプリケーション「かきトレ」** です[cite: 14]。
外部ビルドツールを介さず、ブラウザ標準の **Vanilla ES Modules (`import` / `export`)** による疎結合なモジュール設計を採用しています[cite: 14]。

### 最重要開発規約（厳守ルール）
* **推測や想像によるコード改変の全面禁止**: 必ず提供された既存コードを元にピンポイントで修正を行う。
* **勝手なリファクタリング・コード破壊の禁止**: 動いている実績のある箇所（通信ヘッダー `text/plain;charset=utf-8`、DOM構造、Google Input Tools API のインク座標配列形式など）には絶対に手を触れない[cite: 2, 8]。

---

## 2. システム構成とデータモデル

### A. クラウドデータ基盤（Google スプレッドシート ＆ GAS）
MASTER と LOG の **2ファイル分離型** を採用[cite: 14]。

1. **MASTER スプレッドシート**（ID: `15MNUjS1D9pk4i6miH6dQX7aWpAnyTMXTa_DhpkziaNM`）[cite: 14]
   * **`users` シート**: 児童名簿・暗証番号・設定情報[cite: 14]
     * A列: `userId` | B列: `className` | C列: `studentNo` | D列: `kanaName` | E列: `pin` (4桁) | F列: `handMode` (`right` / `left`) | **G列: `soundMode` (`on` / `off`)**[cite: 14]
   * **`progress` シート**: 進捗サマリー（1児童1行）[cite: 14]
     * A列: `userId`
     * B列: `clearedSets`（連想配列 `{"1学期_01": "ISO日時", ...}` または配列形式）[cite: 5, 9]
     * C列: `weakChars`（苦手漢字統計 `charStats` JSON形式）[cite: 9, 14]
     * D列: `lastLogin`（最終更新日時: `yyyy-MM-dd HH:mm:ss`）[cite: 14, 22]

2. **LOG スプレッドシート**（ID: `1hpgEYbzCFKGeTq6A2GavTGy3QdGrozVCpb4iv7GsA2g`）[cite: 14]
   * **`logs` シート**: 解答1問ごとの追記専用ログ（Append-only）[cite: 14, 22]
     * A列: `timestamp` | B列: `userId` | C列: `setId` | D列: `qIndex` | E列: `isSuccess` (1/0) | F列: `detailJson`[cite: 14, 22]

3. **GAS Web API (`backend.gs`) アクション仕様**[cite: 14, 22]
   * `prefetchAllData`: 起動時の全児童の認証情報（利き手・音設定含む）・進捗サマリー一括返却[cite: 14, 22]。
   * `saveProgressAndLog`: 単元クリア時の進捗更新（MASTER C列マージ）＋詳細ログ追記[cite: 14, 22]。
   * `updateProgress`: 「もどる」ボタン押下時・特訓モード克服時のバックグラウンド軽量進捗同期（`keepalive: true`）[cite: 4, 14, 22]。
   * `updateHandMode`: 利き手設定の即時書き込み（F列）[cite: 14, 22]。
   * `updateSoundMode`: 音設定（`on` / `off`）の即時書き込み（G列）[cite: 22]。
   * `updatePin`: PIN変更の即時書き込み（E列）[cite: 14, 22]。

---

### B. フロントエンド・データ仕様（`charStats` 形式）

スプレッドシート C列（`weakChars`）およびローカルストレージに保持する苦手漢字のデータ構造[cite: 9, 14]：
```json
{
  "現": {
    "history": [false, false, false],
    "lastAttempt": "2026-09-05T08:36:44.331Z",
    "drillCleared": false
  },
  "確": {
    "history": [false, true],
    "lastAttempt": "2026-09-05T08:37:06.583Z",
    "drillCleared": false
  }
}

```

#### 【記録・特訓判定ルール（重要）】

1. **漢字のみを記録対象とする**: 正規表現 `/[一-龯㐀-䶿]/` を用い、送り仮名やひらがなは一切記録しない。


2. **初見正解は登録しない**: 一度も間違えていない文字が初見で `true` 判定された場合は登録をスキップし、C列の肥大化を防ぐ。


3. **誤答時に初めて登録**: 不正解（`false`）が発生した文字のみを `charStats` にエントリーする。


4. **特訓対象判定（`getDrillTargets`）**: 直近が不正解、かつ `drillCleared !== true` の漢字を抽出。


5. **特訓克服判定（`markDrillCleared`）**: 特訓モードで3回連続正解を達成した瞬間に `drillCleared: true` を付与し、特訓対象から除外。



---

## 3. ディレクトリ構成とモジュール一覧

```text
kanji_practice_app/
│
├── index.html                    # 画面DOM（モーダル/メニュー/練習/全問クリア/特訓モーダル/外側デバッグ枠）
├── css/
│   ├── base.css                  # リセット・共通レイアウト
│   ├── modal.css                 # ログイン・ききて設定・音設定・パスワード変更モーダル
│   ├── menu.css                  # メニュー画面・学期タブ・ちょうせんじょう・外側デバッグボタン
│   ├── practice.css              # 練習画面2カラム・キャンバス・操作ボタン
│   ├── result.css                # 判定カード・筆順再生枠・1画面フルスクリーンクリア
│   └── drill.css                 # 特訓モード専用（6文字グリッド・消滅＆✨浮遊アニメーション・高さ固定）
├── data/
│   ├── users.json                # 静的児童名簿（クラス・出席番号・ひらがな名・userId）
│   └── grade5_questions.json     # 小学5年生構造化問題データ（type: normal / okurigana）
├── assets/
│   ├── images/                   # ロゴ・マスコット画像各種
│   └── audio/
│       ├── correct.mp3           # 正解音
│       ├── wrong.mp3             # 不正解音
│       ├── complete.mp3          # 単元全問クリア音・特訓完走ファンファーレ
│       ├── disappear.mp3         # 特訓克服文字の消滅効果音
│       └── drill.mp3             # モーダルオープン着地効果音
└── js/
    ├── main.js                   # アプリ統括・起動時ポップアップチェーン制御（特訓 ➜ 挑戦状）
    ├── auth.js                   # 認証・セッション・各種設定モーダル制御（利き手・音・PIN）
    ├── menu.js                   # メニュー画面・学期タブ・単元ボタングリッド制御
    ├── validator.js              # 手書き文字認識（Google Input Tools）・画数・正誤判定
    ├── canvas.js                 # 260px手書き描画・アンドゥ/リドゥ・ロック制御
    ├── kanjivg.js                # 教科書体SVG描画 & 筆順アニメ・事前プリフェッチ対応
    ├── ui.js                     # 画面DOM描画・マスコット表情連動・画数出し分け制御
    ├── storage.js                # localStorage 永続化・音設定永続化・日次ポップアップ抑制フラグ
    ├── drill.js                  # 特訓モード（3回合格・6文字バッチ・消滅演出・即時同期）
    ├── challenge.js              # 「かきまるからのちょうせん！」5問自動生成ロジック
    ├── messages.js               # アプリ定数・ユーティリティ・かきまるセリフ集
    ├── audio.js                  # Web Audio API プリロード・完全ミュート制御（setAudioMuted）
    └── logger.js                 # GAS Web API 通信（prefetch / save / updateHandMode / updateSoundMode / updatePin）

```

---

## 4. 主な改修履歴

### ① 音のON/OFF（完全ミュート）機能とスプレッドシートG列同期

* ヘッダーの「🎶 / 🔇」アイコンから音設定モーダルを開閉可能に。


* 「おとを ならさない」設定時は `audio.js` の再生関数がすべて即座にバイパスされ、完全無音化。


* 選択結果はローカルストレージだけでなく、`updateSoundModeApi` を通じて MASTER スプレッドシート `users` シートの **G列 (`soundMode`)** に即時書き込まれ、端末間・リロード後も同期。



### ② モーダルインライン進行表示とダイアログ完全撤廃

* パスワード変更モーダル・利き手設定モーダル・音設定モーダルにおいて、ブラウザ標準の `alert()` や `confirm()` を完全排除。


* ボタンエリアと入れ替わりで「ほぞんちゅう…」➜「〜を へんこうしました。」をインライン表示し、3秒後に自動閉鎖するアニメーション演出に統一。


* 入力時のプレースホルダー文字はフォーカス時に非表示化し視認性を向上。



### ③ 起動時ポップアップ優先順位（特訓 ➜ 挑戦状）

* ログイン時に未克服の苦手漢字がある場合、今日まだ閉じていなければ「にがてな かんじ とっくん」を最優先で表示。


* 特訓を終えて（または閉じて）メニューに戻ったタイミングで、続けて「かきまるからの挑戦状」の判定・表示へシームレスに移行。


* モーダルが拡大して元の大きさに落ち着いたタイミング（約300ms後）で `drill.mp3` を再生し、一体感を確保。



```