```markdown
# 📖 漢字練習Webアプリ システム設計・保守・データ定義完全ガイド（HANDOVER）

## 1. 全体構造とアーキテクチャ方針

本プロジェクトは、小学校児童向けのタブレット（Chromebook / iPad 等）およびPC環境で動作する **漢字手書き練習Webアプリケーション** です。
外部ビルドツール（Webpack / Vite 等）を必要とせず、ブラウザ標準の **ES Modules (`import` / `export`)** による疎結合なモジュール設計を採用しています。

### 核心設計思想

1. **関心事の完全分離 (SoC / DRY 原則)**:
   手書き入力制御 (`canvas.js`)、OCR字形認識 (`recognition.js`)、効果音合成・再生 (`audio.js`)、教科書体筆順SVG描画 (`kanjivg.js`)、画面更新 (`ui.js`) を独立したモジュールとして分離し、メインロジック (`main.js`) で統括する。
2. **問題種別に応じた柔軟な入力・判定制御**:
   * **通常問題 (`normal`)**: 最初から正解文字数分のタブ・マスを用意し、目標画数を案内。
   * **送り仮名問題 (`okurigana`)**: 児童が文字数を推測して解けるよう、1文字目のみ表示からスタートし、動的にタブを追加（最大 `maxChars` まで）。ヒント防止のため2文字目以降は画数案内を非表示化。
3. **教育的配慮に基づいたUI・フィードバック**:
   * 日本の文部科学省・筆順指導要領および教科書体に完全準拠した **KanjiVG SVGデータ** を採用。
   * 正誤判定画面は **「上段: 児童の手書き筆跡（◯✕バッジ付き）」** と **「下段: 教科書体のお手本（タップ/クリックで枠内筆順アニメーション再生）」** の上下比較レイアウトに統合。
   * 誤答時のアドバイスは **「① 誤字チェック（ちがう字を書いているかも？）」➔「② 画数チェック（画数がちがうよ）」** の優先順位で分かりやすく通知。
4. **低遅延・頭切れ防止オーディオ**:
   Web Audio API (`AudioContext` + `decodeAudioData`) により MP3 ファイルをメモリ上にプリロード展開。モバイル環境特有の再生遅延や頭切れを根絶。

---

### ディレクトリ構成（最新状態）

```text
kanji_practice_app/
│
├── index.html                    # HTML骨格 (Google Fonts, モジュール読み込み)
├── css/
│   └── style.css                 # 全体スタイルシート (レスポンシブ・アニメーション対応)
├── data/
│   └── questions.json            # 出題問題データ (通常 / 送り仮名 混在定義)
├── assets/
│   └── audio/                    # 効果音アセット (MP3)
│       ├── correct.mp3           # 正解音 (ピンポン♪)
│       ├── wrong.mp3             # 不正解音 (ブブー)
│       └── complete.mp3          # 全問クリア音 (ファンファーレ)
└── js/
    ├── main.js                   # アプリ全体の進行・問題遷移・統合判定ロジック
    ├── canvas.js                 # Canvas手書き描画・画数カウント・ストローク管理
    ├── recognition.js            # Google Input Tools 手書き文字認識 API 連携
    ├── audio.js                  # Web Audio API による MP3 プリロード & 低遅延再生
    ├── kanjivg.js                # 日本の文科省筆順・KanjiVG公式SVG直接描画 & 筆順再生
    ├── ui.js                     # DOM描画・上下比較カード・タブ・メッセージ制御
    └── logger.js                 # （将来拡張用）GAS/スプレッドシート学習ログ送信モジュール

```

---

## 2. モジュール別 仕様・役割分担

### 1. `js/main.js`（アプリケーション統括コントローラー）

* 問題データ (`data/questions.json`) の読み込みと進行管理。
* 「通常問題 (`normal`)」と「送り仮名問題 (`okurigana`)」の入力フロー切り替え。
* 答え合わせ処理（`handleCheck`）:
1. 送り仮名問題の文字数一致チェック（不一致時は「おしい！ 送り仮名がちがうよ。」）。
2. 1文字ごとの個別判定:
* **優先1 (OCR)**: `recognizeChar()` の上位4件に正解文字が含まれるか ➔ 不一致なら「ちがう字を書いているかも？（認識: 「X」）」。
* **優先2 (画数)**: ペン離し回数（`strokeCount`）が目標画数と一致するか ➔ 不一致なら「画数がちがうよ（目標: X画 / 入力: Y画）」。


3. 各文字の正誤配列 `charResults` (`[true, false, ...]`) を生成して `ui.showResultView()` へ伝達。
4. 全問クリア時は `playFanfareSound()` を鳴らし、はなまる画面を表示。



### 2. `js/kanjivg.js`（KanjiVG SVG レンダラー & 筆順アニメーター）

* 文字の Unicode 16進コードから KanjiVG 公式 SVG (`https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/{hex}.svg`) を非同期取得。
* 通常時は教科書体ストロークの静止画として描画。
* 不正解時（`isInteractive = true`）は、クリック/タップ時に `stroke-dashoffset` を用いた1画ごとの滑らかな筆順アニメーションを再生。

### 3. `js/ui.js`（UI レンダラー）

* **上下統合比較ビュー**:
* **上段（あなたの答え）**: 80×80px の枠内にユーザー筆跡を縮小描画し、右上にポップインアニメーション付きの「◯」「✕」バッジを表示。
* **下段（正解のお手本）**: 漢字は `KanjiVGPlayer`、ひらがなは `Klee One` フォントで描画。


* **画数表示制御**:
* 通常問題 ➔ 全文字で「いまの画数: X画 (目標: Y画)」。
* 送り仮名問題 ➔ 1文字目のみ「いまの画数: X画 (目標: Y画)」、2文字目以降は非表示。



### 4. `js/canvas.js`（手書き入力管理）

* Pointer / Touch / Mouse イベントを共通化し、タッチペンおよび指での手書きに完全対応。
* ストローク座標配列（`strokesData`）の記録と、ペン離し回数（`strokeCount`）のカウント。

### 5. `js/recognition.js`（手書き認識 API 連携）

* Google Input Tools 手書き認識 API (`https://inputtools.google.com/request?ime=handwriting...`) へ `ink` 座標データを POST 送信。
* 認識された候補文字（最大5件）を配列で返却。

### 6. `js/audio.js`（低遅延オーディオ管理）

* 初回ユーザー操作時に `AudioContext` をアンロックし、全 MP3 を `decodeAudioData` でオンメモリバッファ化。
* ハードウェア出力回路の起動ラグ・頭切れを排除した即時再生。

---

## 3. データスキーマ定義 (`data/questions.json`)

```json
[
  {
    "type": "normal",
    "sentenceHtml": "<span class=\"highlight-target\">さいしょ</span>に手をあらう。",
    "targets": [
      { "char": "最", "strokes": 12 },
      { "char": "初", "strokes": 7 }
    ]
  },
  {
    "type": "okurigana",
    "notice": "💡 おくりがなまで全部書いてね！",
    "sentenceHtml": "人が急に<span class=\"highlight-target\">あらわれる</span>。",
    "maxChars": 5,
    "targets": [
      { "char": "現", "strokes": 11 },
      { "char": "れ", "strokes": 2 },
      { "char": "る", "strokes": 1 }
    ]
  },
  {
    "type": "okurigana",
    "notice": "💡 おくりがなまで全部書いてね！",
    "sentenceHtml": "<span class=\"highlight-target\">よつば</span>の植物。",
    "maxChars": 3,
    "targets": [
      { "char": "四", "strokes": 5 },
      { "char": "つ", "strokes": 1 },
      { "char": "葉", "strokes": 12 }
    ]
  }
]

```

### スキーマ仕様

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ◯ | `"normal"`（通常問題）または `"okurigana"`（送り仮名問題） |
| `sentenceHtml` | string | ◯ | 問題文。入力対象のひらがな語全体を `<span class="highlight-target">` で囲む |
| `notice` | string | △ | 送り仮名問題時にカード上部に表示する案内文（例: `"💡 おくりがなまで全部書いてね！"`） |
| `maxChars` | number | △ | 送り仮名問題時の最大入力可能文字数（通常は対象ひらがなの文字数） |
| `targets` | array | ◯ | 正解文字オブジェクトの配列。各要素は `{ "char": string, "strokes": number }` |

---

## 4. 今後の開発・拡張 ToDo リスト

* [ ] **学年・単元別セレクターの実装**:
* `data/` 配下に学年・単元別の JSON を配置し、スタート画面で選択して切り替える UI の追加。


* [ ] **児童識別・ログインフローの実装**:
* クラス・出席番号・氏名を選択して学習を開始するスタート画面の追加。


* [ ] **学習ログの自動集計（Googleスプレッドシート / GAS連携）**:
* `js/logger.js` の `sendLog()` を実装し、児童名、問題、正誤結果、誤答時の認識文字・画数エラーを GAS Web API 経由でスプレッドシートに蓄積。


* [ ] **端末・インフラ検証**:
* GIGAスクール端末（Chromebook / iPad）のフィルタリング環境（i-FILTER等）での GitHub Pages アクセスおよび Google Input Tools API 通信の疎通確認。



---

## 5. ローカル実行手順

本アプリは ES Modules および `fetch` API を使用しているため、ローカルで確認する際はローカルWebサーバーを経由して起動してください。

```bash
# Python による簡易ローカルサーバー起動例 (プロジェクトルートで実行)
python -m http.server 8000

```

ブラウザで `http://localhost:8000` にアクセスして動作確認を行います。

```

```