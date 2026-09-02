```markdown
# 📖 漢字練習Webアプリ システム設計・保守・データ定義完全ガイド（HANDOVER v2）

## 1. 全体構造とアーキテクチャ方針

本プロジェクトは、小学校児童向けのタブレット（Chromebook / iPad 等）およびPC環境に最適化された **漢字手書き練習Webアプリケーション** です。
外部ビルドツール（Webpack / Vite 等）を一切使用せず、ブラウザ標準の **ES Modules (`import` / `export`)** による疎結合なモジュール設計を採用しています。

### 核心設計思想

1. **Chromebook（1366×768）完全対応（スクロールゼロ設計）**:
   * アドレスバーやシェルフによる実効表示領域（約550〜600px）を考慮し、全体を `height: 100vh; overflow: hidden;` で固定。
   * 手書きキャンバス（260×260px）と上下配置の正誤判定カード（72×72px）により、一切の縦スクロールを発生させません。
2. **ユニバーサルデザイン・インクルーシブ対応（利き手モード）**:
   * メニュー画面で「みぎきき」「ひだりきき」を選択可能。
   * 左利き時は CSS の `flex-direction: row-reverse;` により、手書き描画領域を画面左側、問題提示を画面右側へと瞬時に反転。書く手で問題文が隠れるのを防ぎます。
3. **教育的配慮に基づいたUI・フィードバック**:
   * 日本の文部科学省・筆順指導要領および教科書体に完全準拠した **KanjiVG公式SVGデータ** を直接描画・アニメーション再生。
   * 誤答時メッセージの優先順位:
     * **通常問題**: 各文字の「① 誤字チェック」➔「② 画数チェック」を改行して出力。
     * **送り仮名問題**: 「1文字目の漢字間違い（最優先）」または「おしい！ 送り仮名がちがうよ。」の2パターンに集約。
4. **低遅延・頭切れ防止オーディオ**:
   Web Audio API (`AudioContext` + `decodeAudioData`) を採用。ボタン操作時にも `ctx.resume()` のガード処理を入れ、自動再生ポリシーによる音切れを防止。

---

### ディレクトリ構成

```text
kanji_practice_app/
│
├── index.html                    # メニュー画面 & 練習画面の2ペイン骨格
├── css/
│   └── style.css                 # 2カラムレイアウト・利き手反転・アニメーション
├── data/
│   └── grade5_questions.json     # 小学5年生 全44回（計220問・各5問）構造化データ
├── assets/
│   └── audio/                    # 効果音アセット (MP3)
│       ├── correct.mp3           # 正解音 (ピンポン♪)
│       ├── wrong.mp3             # 不正解音 (ブブー)
│       └── complete.mp3          # 全問クリア音 (ファンファーレ)
└── js/
    ├── main.js                   # アプリ全体の進行・メニュー遷移・単元切替・統合判定
    ├── canvas.js                 # 260px手書き描画・アンドゥ/リドゥ・ストローク管理
    ├── recognition.js            # Google Input Tools 手書き文字認識 API 連携
    ├── audio.js                  # Web Audio API によるプリロード & 自動再生ガード
    ├── kanjivg.js                # 日本の文科省筆順・KanjiVG公式SVG直接描画 & 筆順再生
    ├── ui.js                     # メニュー/練習/クリア画面DOM描画・利き手制御
    └── logger.js                 # （将来拡張用）GAS/スプレッドシート学習ログ送信モジュール

```

---

## 2. モジュール別 仕様・役割分担

### 1. `js/main.js`（アプリケーション統括コントローラー）

* メニュー画面の単元ボタン（全44回・学期タブ）生成と遷移制御。
* 利き手モードの `localStorage` 保持と反映。
* アンドゥ・リドゥ操作およびショートカットキー（`Ctrl/Cmd+Z`, `Ctrl+Y / Cmd+Shift+Z`）のバインド。
* 単元（5問）の進行管理、正誤判定、連続学習（「つぎの回にすすむ」）処理。

### 2. `js/ui.js`（UI レンダラー）

* `setHandedness(isLeftHanded)`: `.left-handed` クラスの付与による左右反転。
* `showMenuView()` / `showPracticeView()`: メニュー画面と練習画面のシームレスな切り替え。
* `showResultView()`: 描画ペイン内の上下比較カード ＋ アドバイスメッセージ ＋ やり直すボタンの表示。
* `showAllClear()`: 描画ペイン中央に「💮 はなまる満点！」と次セットへ進むボタンを大きく表示。

### 3. `js/kanjivg.js`（KanjiVG SVG レンダラー & 筆順アニメーター）

* Unicode 16進コードから KanjiVG 公式 SVG を取得。
* 静止画として教科書体を表示し、不正解時はタップ/クリックで枠内筆順アニメーション（`stroke-dashoffset`）を再生。

### 4. `js/canvas.js`（手書き入力 & 履歴管理）

* 260×260px のマス目描画。
* `strokesData` と `redoStack` による1画ずつの「↶ もどす」「↷ すすむ」制御。

### 5. `js/audio.js`（オーディオ制御）

* `ensureAudioUnlocked()` による都度 `ctx.resume()` ガード。Chromebookでの確実な音声出力を担保。

---

## 3. データスキーマ定義 (`data/grade5_questions.json`)

```json
{
  "grade": 5,
  "title": "小学5年生",
  "totalSets": 44,
  "sets": [
    {
      "id": "1学期_01",
      "title": "1学期 第01回",
      "questions": [
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
          "sentenceHtml": "<span class=\"highlight-target\">たしか</span>に軽い。",
          "notice": "💡 おくりがなまで全部書いてね！",
          "maxChars": 3,
          "targets": [
            { "char": "確", "strokes": 15 },
            { "char": "か", "strokes": 3 }
          ]
        }
      ]
    }
  ]
}

```

---

## 4. 今後の開発・拡張 ToDo リスト

* [ ] **学年の拡充**:
* `data/grade1_questions.json` 〜 `data/grade6_questions.json` を順次追加し、メニューの学年セレクトと連動。


* [ ] **学習ログの自動集計（GAS / Googleスプレッドシート連携）**:
* `js/logger.js` を有効化し、児童名、学年、単元、正誤結果、画数エラーログをクラウド送信。


* [ ] **進捗バッジ・クリアマークの記録**:
* 単元ボタン（第01回〜第44回）にクリア済みの「💮」アイコンを表示する進捗記録機能。



```