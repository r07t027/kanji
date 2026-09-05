```markdown
# 📖 漢字練習Webアプリ「かきトレ」システム設計・保守・データ定義完全ガイド（HANDOVER v6）

## 1. アプリケーション概要と基本方針

本プロジェクトは、小学校児童向けのタブレット（Chromebook / iPad 等）およびPC環境に最適化された **漢字手書き練習Webアプリケーション「かきトレ」** です[cite: 14]。
外部ビルドツールを介さず、ブラウザ標準の **Vanilla ES Modules (`import` / `export`)** による疎結合なモジュール設計を採用しています[cite: 14]。

### 最重要開発規約（厳守ルール）
* **推測や想像によるコード改変の全面禁止**: 必ず提供された既存コードを元にピンポイントで修正を行う。
* **勝手なリファクタリング・コード破壊の禁止**: 動いている実績のある箇所（通信ヘッダー `text/plain;charset=utf-8`、DOM構造、Google Input Tools API のインク座標配列形式など）には絶対に手を触れない[cite: 2, 9]。

---

## 2. システム構成とデータモデル

### A. クラウドデータ基盤（Google スプレッドシート ＆ GAS）
MASTER と LOG の **2ファイル分離型** を採用[cite: 14]。

1. **MASTER スプレッドシート**（ID: `15MNUjS1D9pk4i6miH6dQX7aWpAnyTMXTa_DhpkziaNM`）[cite: 11]
   * **`users` シート**: 児童名簿・暗証番号・設定情報[cite: 14]
     * A列: `userId` | B列: `className` | C列: `studentNo` | D列: `kanaName` | E列: `pin` (4桁) | F列: `handMode` (`right` / `left`)[cite: 14]
   * **`progress` シート**: 進捗サマリー（1児童1行）[cite: 14]
     * A列: `userId`
     * B列: `clearedSets`（連想配列 `{"1学期_01": "ISO日時", ...}` または配列形式）[cite: 5, 11]
     * C列: `weakChars`（苦手漢字統計 `charStats` JSON形式）[cite: 11, 14]
     * D列: `lastLogin`（最終更新日時: `yyyy-MM-dd HH:mm:ss`）[cite: 11, 14]

2. **LOG スプレッドシート**（ID: `1hpgEYbzCFKGeTq6A2GavTGy3QdGrozVCpb4iv7GsA2g`）[cite: 11]
   * **`logs` シート**: 解答1問ごとの追記専用ログ（Append-only）[cite: 11, 14]
     * A列: `timestamp` | B列: `userId` | C列: `setId` | D列: `qIndex` | E列: `isSuccess` (1/0) | F列: `detailJson`[cite: 11, 14]

3. **GAS Web API (`backend.gs`) アクション仕様**[cite: 11]
   * `prefetchAllData`: 起動時の全児童の認証情報・進捗サマリー一括返却[cite: 11]。
   * `saveProgressAndLog`: 単元クリア時の進捗更新（MASTER C列マージ）＋詳細ログ追記[cite: 11]。
   * `updateProgress`: 「もどる」ボタン押下時・挑戦モードクリア時のバックグラウンド軽量進捗同期[cite: 2, 10, 11]。
   * `updateHandMode` / `updatePin`: 利き手設定・PIN変更の即時書き込み[cite: 11]。

---

### B. フロントエンド・データ仕様（`charStats` 形式）

スプレッドシート C列（`weakChars`）およびローカルストレージに保持する苦手漢字のデータ構造[cite: 5, 11]：
```json
{
  "現": {
    "history": [false, false, false],
    "lastAttempt": "2026-09-05T08:36:44.331Z"
  },
  "確": {
    "history": [false, true],
    "lastAttempt": "2026-09-05T08:37:06.583Z"
  }
}

```

#### 【記録ルール（重要）】

1. **漢字のみを記録対象とする**: 正規表現 `/[一-龯㐀-䶿]/` を用い、送り仮名やひらがな（「れ」「る」「つ」など）は一切記録しない。


2. **初見正解は登録しない**: 一度も間違えていない文字が初見で `true` 判定された場合は登録をスキップし、C列の肥大化を防ぐ。


3. **誤答時に初めて登録**: 不正解（`false`）が発生した文字のみを `charStats` にエントリーする。


4. **過去の誤答漢字は克服追跡**: 既に登録されている漢字については、克服状況を判定するため復習時の `true` も直近3回のリングバッファ（`history`）に追記する。


5. **初回試行のみ記録**: お手本を見た後の「もういちど」書き直し結果は苦手統計に混入させない（`hasAttemptedFirst` フラグ制御）。



---

## 3. ディレクトリ構成とモジュール一覧

```text
kanji_practice_app/
│
├── index.html                    # 画面DOM（モーダル/メニュー/練習/全問クリア/外側デバッグ枠）
├── css/
│   ├── base.css                  # リセット・共通レイアウト
│   ├── modal.css                 # ログイン・ききて設定・パスワード変更モーダル
│   ├── menu.css                  # メニュー画面・学期タブ・ちょうせんじょう・外側デバッグボタン
│   ├── practice.css              # 練習画面2カラム・利き手反転・キャンバス・操作ボタン
│   └── result.css                # 上下判定カード・筆順再生枠・1画面フルスクリーンクリア
├── data/
│   ├── users.json                # 静的児童名簿（クラス・出席番号・ひらがな名・userId）
│   └── grade5_questions.json     # 小学5年生構造化問題データ（type: normal / okurigana）
├── assets/
│   ├── images/
│   │   ├── logo_01.png           # 公式ロゴ
│   │   ├── kakimaru_01〜08.png   # 練習中マスコット表情連動
│   │   ├── kakimaru_09.png       # 通常クリア（はなまる満点）
│   │   ├── kakimaru_10.png       # ちょうせんじょう・ヘッダーアイコン
│   │   └── kakimaru_11.png       # 挑戦勝利（参りましたポーズ）
│   └── audio/                    # correct.mp3 / wrong.mp3 / complete.mp3
└── js/
    ├── main.js                   # アプリ統括・進行制御・先読みフック・認証後トリガー
    ├── auth.js                   # 認証・セッション・設定モーダル制御
    ├── menu.js                   # メニュー画面・学期タブ・単元ボタングリッド制御
    ├── validator.js              # 手書き文字認識（Google Input Tools）・画数・正誤判定
    ├── canvas.js                 # 260px手書き描画・アンドゥ/リドゥ・ストローク管理
    ├── kanjivg.js                # 教科書体SVG描画 & 筆順アニメ・【事前プリフェッチ対応】
    ├── ui.js                     # 画面DOM描画・マスコット表情連動・画数出し分け制御
    ├── storage.js                # localStorage 永続化・漢字判定ガード・苦手文字リングバッファ
    ├── challenge.js              # 「かきまるからのちょうせん！」アラカルト5問自動生成ロジック
    ├── messages.js               # アプリ定数・ユーティリティ・かきまるセリフ集
    ├── audio.js                  # Web Audio API プリロード・再生アンロック制御
    └── logger.js                 # GAS Web API 通信（prefetch / save / update）

```

---

## 4. 主な改修履歴と実装済み仕様

### ① 苦手漢字統計（`charStats`）の完全復旧

* `backend.gs` の `handleSaveProgressAndLog` および `handleUpdateProgress` に `mergeCharStats` を実装し、クライアントからの最新統計を既存データと安全にマージして C列に書き込むよう是正。


* `storage.js` および `main.js` に `KANJI_REGEX` ガードを追加し、送り仮名等のひらがな混入を完全遮断。初見正解（`[true]` のみ）の文字が不要に記録される不具合を解消。



### ② 「四つ葉」など途中ひらがなを含む通常問題の画数表示最適化

* 通常問題において、ひらがな（「つ」等）を書き取る際には目標画数・現在画数の案内を自動で非表示（空白保持）にするよう `ui.js` と `main.js` を改修。



### ③ お手本SVGのゼロ秒レスポンス化（プリフェッチ）

* 問題切り替え時（`loadQuestion`）に、出題されるターゲット漢字の KanjiVG SVG データをバックグラウンドで事前取得してメモリ（`svgCache`）に保持する `prefetchKanjiVG` を実装。


* 解答判定直後のお手本表示におけるタイムラグを解消。



### ④ ログイン時の挑戦状判定トリガー修正

* `auth.js` の `onUserAuthenticated` コールバック内に `this.checkDailyChallenge()` を追加し、リロードせずとも初回ログイン直後に正しく挑戦状パネルが表示されるよう修正。



### ⑤ UI・レイアウトの最適化

* **挑戦状パネル**:
* タイトル: 胴着アイコンを削除し「ちょうせんじょう」を中央揃え。


* 本文: 「きみに かきとりしょうぶを もうしこむ！ / これまでの かんじから ５もん だすよ。 / いざ しょうぶ！」（3行左寄せ）。


* 署名: 「かきまる より」（右寄せ）。


* 承認ボタン: 「うけてたつ！」に簡略化。




* **メニュー画面ヘッダー**:
* ユーザー情報バー: 上半身アイコン（👤）を削除し、クラス名と氏名を左寄せに配置。


* 挑戦状ボタン: ヘッダー幅を圧迫していた長文テキストを廃止し、かきまるアイコン（`kakimaru_10.png`）のみの正方形ボタン（44×44px）にコンパクト化。




* **デバッグボタンの退避**:
* 「🔄 制限リセット」ボタンを白いカード（`.menu-card`）の外側最下部（`.menu-debug-area`）に目立たない点線枠として逃がし、児童の誤操作を防止。




* **「チャレンジする」ボタンの中央揃え**:
* `.btn-start-wrapper` を導入し、単元グリッドの真下に美しく中央配置。





---

## 5. 次のスレッドで着手・検討すべき事項

1. **挑戦状の出題・勝敗バランスのチューニング (`challenge.js`)**:
* 苦手漢字が存在しない（または全問正解続きの）場合のフォールバック出題の検証。
* 挑戦状クリア時の演出およびログ記録の継続確認。




2. **スプレッドシート MASTER C列のクリーンアップ**:
* 過去のデバッグで混入したひらがなデータ（`"れ":{...}` 等）は手動削除済み。今後再発しないかの継続監視。


3. **他学年データ・追加コンテンツの整備**:
* 6年生・下級生問題データの拡充時のデータ構造適合確認。



```