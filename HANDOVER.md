```markdown
# 📖 漢字練習Webアプリ「かんトレ」システム設計・保守・データ定義完全ガイド（HANDOVER v10）

## 1. アプリケーション概要と基本方針

本プロジェクトは、小学校児童向けのタブレット（Chromebook / iPad 等）およびPC環境に最適化された **漢字手書き練習Webアプリケーション「かんトレ」**（旧称: かきトレ）です[cite: 1]。
外部ビルドツールを介さず、ブラウザ標準の **Vanilla ES Modules (`import` / `export`)** による疎結合なモジュール設計を採用しています[cite: 1]。

### 最重要開発規約（厳守ルール）
* **推測や想像によるコード改変の全面禁止**: 必ず提供された既存コードを元にピンポイントで修正を行う[cite: 1]。
* **勝手なリファクタリング・コード破壊の禁止**: 動いている実績のある箇所（通信ヘッダー `text/plain;charset=utf-8`、DOM構造、Google Input Tools API のインク座標配列形式など）には絶対に手を触れない[cite: 1]。

---

## 2. システム構成とデータモデル

### A. クラウドデータ基盤（Google スプレッドシート ＆ GAS）
MASTER と LOG の **2ファイル分離型** を採用[cite: 1]。

1. **MASTER スプレッドシート**（ID: `15MNUjS1D9pk4i6miH6dQX7aWpAnyTMXTa_DhpkziaNM`）[cite: 1]
   * **`users` シート**: 児童名簿・暗証番号・設定情報[cite: 1]
     * A列: `userId` | B列: `className` | C列: `studentNo` | D列: `kanaName` | E列: `pin` (4桁) | F列: `handMode` (`right` / `left`) | **G列: `soundMode` (`on` / `off`)**[cite: 1]
   * **`progress` シート**: 進捗サマリー（1児童1行）[cite: 1]
     * A列: `userId`
     * B列: `clearedSets`（連想配列 `{"1学期_01": "ISO日時", ...}` または配列形式）[cite: 1]
     * C列: `weakChars`（苦手漢字統計 `charStats` JSON形式）[cite: 1]
     * D列: `lastLogin`（最終更新日時: `yyyy-MM-dd HH:mm:ss`）[cite: 1]

2. **LOG スプレッドシート**（ID: `1hpgEYbzCFKGeTq6A2GavTGy3QdGrozVCpb4iv7GsA2g`）[cite: 1]
   * **`logs` シート**: 解答1問ごとの追記専用ログ（Append-only）[cite: 1]
     * A列: `timestamp` | B列: `userId` | C列: `setId` | D列: `qIndex` | E列: `isSuccess` (1/0) | F列: `detailJson`[cite: 1]

3. **GAS Web API (`backend.gs`) アクション仕様**[cite: 1]
   * `prefetchAllData`: 起動時の全児童の認証情報（利き手・音設定含む）・進捗サマリー一括返却[cite: 1]。
   * `saveProgressAndLog`: 単元クリア時の進捗更新（MASTER C列マージ）＋詳細ログ追記[cite: 1]。
   * `updateProgress`: 「もどる」ボタン押下時・特訓モード克服時のバックグラウンド軽量進捗同期（`keepalive: true`）[cite: 1]。
   * `updateHandMode`: 利き手設定の即時書き込み（F列）[cite: 1]。
   * `updateSoundMode`: 音設定（`on` / `off`）の即時書き込み（G列）[cite: 1]。
   * `updatePin`: PIN変更の即時書き込み（E列）[cite: 1]。

---

### B. フロントエンド・データ仕様（`charStats` 形式）

スプレッドシート C列（`weakChars`）およびローカルストレージに保持する苦手漢字のデータ構造[cite: 1]：
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
├── index.html                    # 画面DOM（スプラッシュ画面/モーダル/メニュー/練習/全問クリア/特訓モーダル）
├── css/
│   ├── base.css                  # リセット・共通レイアウト・スプラッシュ画面スタイル
│   ├── modal.css                 # ログイン・ききて設定・音設定・パスワード変更モーダル
│   ├── menu.css                  # メニュー画面・学期タブ・ちょうせんじょう・外側デバッグボタン
│   ├── practice.css              # 練習画面2カラム・キャンバス・操作ボタン
│   ├── result.css                # 判定カード・筆順再生枠・1画面フルスクリーンクリア
│   └── drill.css                 # 特訓モード専用（6文字グリッド・消滅＆✨浮遊アニメーション・高さ固定）
├── data/
│   ├── users.json                # 静的児童名簿（クラス・出席番号・ひらがな名・userId）
│   └── grade5_questions.json     # 小学5年生構造化問題データ（type: normal / okurigana）
├── assets/
│   ├── images/
│   │   ├── logo_01.png           # 公式横長ロゴ（ヘッダー・ログインモーダル用）
│   │   ├── logo_02.png           # 公式シンボルロゴ（スプラッシュ・読み込み待ち用）
│   │   ├── tokkun.png            # 特訓道着アイコン
│   │   └── kakimaru_01〜12.png   # マスコット表情連動
│   └── audio/                    # correct.mp3 / wrong.mp3 / complete.mp3 / disappear.mp3 / drill.mp3
└── js/
    ├── main.js                   # アプリ統括・スプラッシュ制御・起動時ポップアップチェーン
    ├── auth.js                   # 認証・セッション・設定モーダル制御（スプレッドシート完全同期）
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

### ① アプリ名称を「かんトレ」に改定

* 公式ロゴ `logo_01.png`（横長）および `logo_02.png`（円形シンボル）の配置を完了。


* アプリ起動時に `logo_02.png` をあしらったスプラッシュ画面を表示し、データの準備が整うまで心地よく待機できるUIを実現。



### ② 音のON/OFF（完全ミュート）機能とスプレッドシートG列同期

* ヘッダーの「🎶 / 🔇」アイコンから音設定モーダルを開閉可能に。


* 「おとを ならさない」設定時は `audio.js` の再生関数がすべて即座にバイパスされ、完全無音化。


* 選択結果は MASTER スプレッドシート `users` シートの **G列 (`soundMode`)** に即時書き込まれ、端末間・リロード後も同期。



### ③ 端末間キャッシュ同期の是正

* キャッシュ復元時にもスプレッドシートの `prefetchPromise` 完了を同期待機し、他端末で進めた最新進捗・苦手文字数とのズレを解消。



### ④ 起動時モーダルチェーン＆認証フローの正常化（v10）

* **未ログイン時の初期化保証**: `init()` 完了時に全画面ローディング（`#app-loading-screen`）を確実に非表示化（`finally` 節）。未ログイン状態での日次モーダル（特訓・挑戦状）の誤爆発火を抑止し、ログインモーダルを最前面に正しく表示する構造に分離。


* **ローカル名簿フォールバック**: オフライン時やスプレッドシート通信エラー時でも `data/users.json` から名簿を構築し、画面停止を防止。
* **ログイン後チェーンの整理**: ログイン完了時（新規・自動復元問わず）のコールバック `onUserAuthenticated` を起点として、苦手特訓モーダル（存在時）→ 挑戦状モーダル（条件合致時）のポップアップチェーンを正しく実行。

### ⑤ かきまる挑戦状モーダル表示時のヘッダーアイコン常時表示（v10）

* **排他非表示の撤廃**: 挑戦権がある当日は、挑戦状モーダルの開閉状態や特訓モーダルからの画面遷移にかかわらず、ヘッダー右上の挑戦アイコン（`#btn-header-challenge`）を常時表示（`display: flex`）として維持。


* 特訓一覧画面で「メニューへもどる」を押して挑戦状モーダルが表示された際にも、背景のヘッダーアイコンが不自然に消去されないよう修正。