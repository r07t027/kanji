import os
import sys
import glob
import json
import time
import base64
import io
import subprocess
import threading
import http.server
import socketserver
import webbrowser
from collections import deque
import webview
from PIL import Image
from google import genai
from google.genai import types

# ==========================================
# 汎用設定 & プロジェクト自動判別
# ==========================================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_NAME = os.path.basename(CURRENT_DIR)
PORT = 8000

SPEC_CANDIDATES = ["HANDOVER.md", "README.md", "SPEC.md"]
SPEC_FILE = next((f for f in SPEC_CANDIDATES if os.path.exists(os.path.join(CURRENT_DIR, f))), "HANDOVER.md")

TARGET_EXTS = ["*.html", "*.css", "*.js", "*.json", "*.svg", "*.md"]
IGNORE_DIRS = [".git", "node_modules", "data_backup", "__pycache__", "venv", "myenv", ".vscode"]
IGNORE_FILES = ["ai_studio.py", "package-lock.json"]

AVAILABLE_MODELS = [
    {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (RPD 500 / RPM 15)"},
    {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite (RPD 500 / RPM 15)"},
    {"id": "gemini-3.7-flash",      "name": "Gemini 3.7 Flash (RPD 20 / 高精度)"},
    {"id": "gemini-3.5-flash",      "name": "Gemini 3.5 Flash (RPD 20 / 高精度)"}
]

# ==========================================
# 簡易HTTPサーバー（キャッシュ無効化）
# ==========================================
class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CURRENT_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

class UniversalStudioAPI:
    def __init__(self):
        self.client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
        self.current_model = "gemini-3.5-flash-lite"
        self.server_thread = None
        self.httpd = None
        self.window = None
        self.chat = None
        
        self.total_tokens_session = 0
        self.token_history_60s = deque()
        self.turn_read_count = 0

        self.start_local_server()
        self.init_gemini()

    def set_window(self, window):
        self.window = window

    # --- 0. 組み込みWebサーバー制御 ---
    def start_local_server(self):
        def serve():
            socketserver.TCPServer.allow_reuse_address = True
            try:
                with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
                    self.httpd = httpd
                    print(f"🚀 Web Server running at http://localhost:{PORT}")
                    httpd.serve_forever()
            except Exception as e:
                print(f"⚠️ Web Server Error: {e}")

        self.server_thread = threading.Thread(target=serve, daemon=True)
        self.server_thread.start()

    def open_web_app(self):
        """標準ブラウザでアプリを開く"""
        url = f"http://localhost:{PORT}/index.html"
        webbrowser.open(url)
        if self.window:
            self.window.evaluate_js(f"window.appendSystemLog({json.dumps(f'🌐 ブラウザで開きました: {url}')})")
        return "opened"

    # --- 1. トークン集計ヘルパー ---
    def record_tokens(self, token_count):
        now = time.time()
        self.total_tokens_session += token_count
        self.token_history_60s.append((now, token_count))
        while self.token_history_60s and (now - self.token_history_60s[0][0] > 60):
            self.token_history_60s.popleft()
        
        current_tpm = sum(count for _, count in self.token_history_60s)
        if self.window:
            self.window.evaluate_js(f"window.updateTokenStats({self.total_tokens_session}, {current_tpm})")

    def get_current_tpm(self):
        now = time.time()
        while self.token_history_60s and (now - self.token_history_60s[0][0] > 60):
            self.token_history_60s.popleft()
        current_tpm = sum(count for _, count in self.token_history_60s)
        return self.total_tokens_session, current_tpm

    # --- 2. プロジェクト走査 & Gemini 初期化 ---
    def collect_project_structure(self):
        spec_text = ""
        if os.path.exists(SPEC_FILE):
            try:
                with open(SPEC_FILE, "r", encoding="utf-8") as f:
                    spec_text = f.read()
            except Exception:
                pass

        file_list = []
        for root, dirs, files in os.walk(CURRENT_DIR):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            for file in files:
                if any(file.endswith(bak) for bak in [".bak", ".tmp"]):
                    continue
                if file in IGNORE_FILES:
                    continue
                if any(file.endswith(ext.replace("*", "")) for ext in TARGET_EXTS):
                    filepath = os.path.relpath(os.path.join(root, file), CURRENT_DIR)
                    file_list.append(filepath)
        
        file_tree_str = "\n".join(f"- {f}" for f in sorted(file_list))
        return spec_text, file_tree_str

    def init_gemini(self):
        spec_text, file_tree_str = self.collect_project_structure()

        def read_project_file(filepath: str) -> str:
            """指定されたプロジェクト内ファイルの内容を読み取るツール（1ターン2回まで制限）"""
            if self.turn_read_count >= 2:
                return "【制限】1回のターンで読み込めるファイルは最大2つまでです。これまでに読み込んだファイルの内容を整理してユーザーへ報告し、必要に応じて次の指示を仰いでください。"

            norm_path = os.path.normpath(filepath)
            if os.path.isabs(norm_path) or norm_path.startswith(".."):
                return "エラー: プロジェクト外のパスは指定できません。"
            
            full_path = os.path.join(CURRENT_DIR, norm_path)
            if not os.path.exists(full_path):
                return f"エラー: ファイル '{filepath}' が見つかりません。"
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    content = f.read()
                self.turn_read_count += 1
                if self.window:
                    self.window.evaluate_js(f"window.appendSystemLog({json.dumps(f'📖 {filepath} を読み込みました ({self.turn_read_count}/2)')})")
                return content
            except Exception as e:
                return f"エラー: {e}"

        def save_project_file(filepath: str, content: str, summary_ja: str) -> str:
            """プロジェクト内のファイルを更新・新規作成するツール"""
            norm_path = os.path.normpath(filepath)
            if os.path.isabs(norm_path) or norm_path.startswith(".."):
                return "エラー: プロジェクト外のパスは指定できません。"

            full_path = os.path.join(CURRENT_DIR, norm_path)
            try:
                dir_name = os.path.dirname(full_path)
                if dir_name:
                    os.makedirs(dir_name, exist_ok=True)

                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(content)

                if self.window:
                    self.window.evaluate_js(f"window.onFileUpdated('{filepath}', {json.dumps(summary_ja)})")
                return f"成功: {filepath} を正常に更新しました。"
            except Exception as e:
                return f"エラー: {e}"

        system_instruction = f"""
あなたは「{PROJECT_NAME}」プロジェクト（ES Modules / Vanilla JS 構成のWebアプリケーション）専属のリードエンジニアです。

=== 【仕様・引き継ぎ書 ({SPEC_FILE})】 ===
{spec_text}

=== 【プロジェクト内のファイル構成】 ===
{file_tree_str}

【最重要禁止事項：無断でのコード改変・機能改変・UIレイアウト改変の絶対禁止】
1. ★【指示外の改変・破壊の完全禁止】：ユーザーから明示的に指示された箇所以外のコード、既存の機能（手書き描画、OCR認識、KanjiVG筆順再生、Web Audio再生、上下比較UI、判定ロジック等）、および画面のUI・HTML構造・CSSレイアウトを勝手に改変・再設計・簡略化・削除することは一切禁止です。
2. ★【コードの完全保持と安全マージ】：ファイルを更新する際は、指示されたピンポイントの修正・機能追加のみを既存コードに正確にマージし、既存のすべてのロジック・レイアウトを100%完全に保持してください。
3. ★【省略コメントの禁止】：「// ...既存のコード...」のような省略表現を使ってファイル全体を壊すことは絶対に許されません。完全なコードを出力してください。
4. ★【モジュール設計（SoC原則）の遵守】：ES Modules による関心事の分離（UI、手書き、判定、音声、KanjiVG）を維持し、1つのモジュールに責任を肥大化させないでください。

【APIレート制限（TPM）の遵守】
当環境は1分あたりのトークン消費量（TPM）に上限（250K TPM）がある無料枠APIで稼働しています。

【行動指針】
1. 【1ターン最大2ファイルの原則】
   - コード本文はあらかじめ読み込まれていません。
   - `read_project_file` は1回の回答で「最大2ファイル」まで読み込み可能です。
   - 必要なファイル（最大2つ）を読み込んだら、ファイルについての見解や変更方針をユーザーに報告し、次の指示を仰いでください。
2. 【HANDOVER.mdについて】
   - 通常の改修作業中に `HANDOVER.md` を読み書きする必要はありません（専用の更新機能から行われます）。
3. 【ファイル更新の実行】
   - コード修正や新規作成を行う際は、必ず提供されている `save_project_file` ツールを呼び出して対象ファイルを更新してください。
4. 【規約遵守と明確な要約】
   - 仕様書に記載された設計思想やコーディング規約を厳格に遵守してください。
   - `save_project_file` 呼び出し時は、修正内容の要約（summary_ja）を明確に日本語で添えてください。
"""

        self.chat = self.client.chats.create(
            model=self.current_model,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[read_project_file, save_project_file]
            )
        )

    def switch_model(self, new_model_id):
        self.current_model = new_model_id
        self.init_gemini()
        return f"モデルを {new_model_id} に切り替えました。"

    # --- 3. メッセージ送信（複数添付対応） ---
    def send_message(self, user_text, attachments=None):
        self.turn_read_count = 0
        if attachments is None:
            attachments = []
        
        def worker():
            start_time = time.time()
            try:
                contents = []
                file_text_parts = []

                for att in attachments:
                    att_type = att.get("type")
                    if att_type == "image":
                        raw_b64 = att.get("base64", "")
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",")[1]
                        img_data = base64.b64decode(raw_b64)
                        pil_img = Image.open(io.BytesIO(img_data))
                        contents.append(pil_img)
                    elif att_type == "text":
                        fname = att.get("name", "添付ファイル")
                        fcontent = att.get("content", "")
                        file_text_parts.append(f"【添付ファイル: {fname}】\n```\n{fcontent}\n```")

                final_text = ""
                if file_text_parts:
                    final_text += "\n\n".join(file_text_parts) + "\n\n"
                
                if user_text:
                    final_text += user_text

                if not final_text and not contents:
                    final_text = "内容を解析してください。"

                if final_text:
                    contents.append(final_text)

                response = self.chat.send_message(contents)
                elapsed = time.time() - start_time
                
                tokens_used = 0
                if hasattr(response, "usage_metadata") and response.usage_metadata:
                    tokens_used = response.usage_metadata.total_token_count or 0
                self.record_tokens(tokens_used)

                text = response.text or "（必要な処理を完了しました）"
                self.window.evaluate_js(f"window.appendAssistantMessage({json.dumps(text)}, {tokens_used}, {elapsed:.1f})")
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    err_msg = "⚠️ レート制限（429）に達しました。上部のモデル切り替えを行うか、約30秒待機してください。"
                else:
                    err_msg = f"⚠️ エラー: {err_str}"
                self.window.evaluate_js(f"window.appendAssistantMessage({json.dumps(err_msg)}, 0, 0)")

        threading.Thread(target=worker, daemon=True).start()
        return "accepted"

    def get_file_content(self, filepath):
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    return f.read()
            except Exception as e:
                return f"読み込み失敗: {e}"
        return "ファイルが見つかりません。"

    def open_in_finder(self):
        try:
            if sys.platform == "darwin":
                subprocess.run(["open", CURRENT_DIR])
            elif sys.platform == "win32":
                os.startfile(CURRENT_DIR)
            else:
                subprocess.run(["xdg-open", CURRENT_DIR])
            if self.window:
                self.window.evaluate_js(f"window.appendSystemLog({json.dumps('📂 フォルダをFinderで開きました')})")
            return "opened"
        except Exception as e:
            err_msg = f"⚠️ フォルダを開けませんでした: {e}"
            if self.window:
                self.window.evaluate_js(f"window.appendSystemLog({json.dumps(err_msg)})")
            return "error"

    def update_handover_doc(self):
        def worker():
            start_time = time.time()
            try:
                self.window.evaluate_js(f"window.appendSystemLog({json.dumps(f'📑 {SPEC_FILE} の更新を生成中...')})")
                
                current_spec = ""
                spec_path = os.path.join(CURRENT_DIR, SPEC_FILE)
                if os.path.exists(spec_path):
                    with open(spec_path, "r", encoding="utf-8") as f:
                        current_spec = f.read()

                git_stat = subprocess.run(["git", "diff", "--stat"], capture_output=True, text=True).stdout
                git_diff = subprocess.run(["git", "diff"], capture_output=True, text=True).stdout[:2500]
                _, file_tree = self.collect_project_structure()

                prompt = f"""あなたは「{PROJECT_NAME}」Webアプリ開発プロジェクトのリードエンジニアです。
プロジェクトの仕様・保守・引き継ぎ書「{SPEC_FILE}」を最新の状態に更新してください。

【既存の {SPEC_FILE}】
{current_spec or '(新規作成)'}

【プロジェクトの最新ファイル構成】
{file_tree}

【直近の変更差分】
{git_stat}
{git_diff}

【指示】
- アプリの概要、ES Modules設計方針、各モジュール（js/、data/、css/等）の役割、データスキーマ定義、ToDoリスト、直近の改修内容を網羅した Markdown 形式の完全なドキュメントを出力してください。
- 挨拶や余計な説明文、前置きは一切不要です。純粋な Markdown 本文のみを出力してください。
"""

                response = self.client.models.generate_content(
                    model=self.current_model,
                    contents=prompt
                )
                
                elapsed = time.time() - start_time
                tokens_used = 0
                if hasattr(response, "usage_metadata") and response.usage_metadata:
                    tokens_used = response.usage_metadata.total_token_count or 0
                self.record_tokens(tokens_used)

                new_content = response.text.strip()
                if new_content.startswith("```markdown"):
                    new_content = new_content[11:]
                if new_content.startswith("```"):
                    new_content = new_content[3:]
                if new_content.endswith("```"):
                    new_content = new_content[:-3]
                new_content = new_content.strip()

                with open(spec_path, "w", encoding="utf-8") as f:
                    f.write(new_content)

                self.window.evaluate_js(f"window.onFileUpdated('{SPEC_FILE}', '引き継ぎ仕様書を最新の状態に更新しました')")
                self.window.evaluate_js(f"window.appendAssistantMessage({json.dumps(f'✅ {SPEC_FILE} を最新状態に更新しました。')}, {tokens_used}, {elapsed:.1f})")

            except Exception as e:
                err_msg = f"⚠️ {SPEC_FILE} 更新エラー: {str(e)}"
                try:
                    self.window.evaluate_js(f"window.appendSystemLog({json.dumps(err_msg)})")
                except Exception:
                    pass

        threading.Thread(target=worker, daemon=True).start()
        return "processing"

    def exit_and_commit(self):
        def worker():
            try:
                self.window.evaluate_js(f"window.appendSystemLog({json.dumps('📦 Gitコミットメッセージを生成中...')})")
                
                subprocess.run(["git", "add", "."], check=True)
                
                diff_check = subprocess.run(["git", "diff", "--cached", "--quiet"])
                if diff_check.returncode == 0:
                    self.window.evaluate_js(f"window.appendSystemLog({json.dumps('ℹ️ コミット対象の差分はありませんでした。')})")
                    time.sleep(1.0)
                    self.window.destroy()
                    return

                git_stat = subprocess.run(["git", "diff", "--cached", "--stat"], capture_output=True, text=True).stdout
                git_diff = subprocess.run(["git", "diff", "--cached"], capture_output=True, text=True).stdout[:1500]

                last_user_prompt = ""
                if self.chat and hasattr(self.chat, "_history"):
                    for msg in reversed(self.chat._history):
                        if getattr(msg, "role", "") == "user":
                            for part in getattr(msg, "parts", []):
                                if hasattr(part, "text") and part.text:
                                    last_user_prompt = part.text[:100]
                                    break
                        if last_user_prompt:
                            break

                prompt = f"""以下のGitの変更内容および指示内容に基づき、適切なGitのコミットメッセージを「日本語で1行（50文字以内）」のみ作成してください。

【厳格なルール】
- 挨拶、解説、選択肢、補足説明、バッククォート、箇条書きは絶対に含めないでください。
- コミットメッセージの文字列そのものだけを出力してください。

【ユーザーの指示内容】
{last_user_prompt or 'Webアプリ機能更新'}

【変更ファイル一覧】
{git_stat}

【差分抜粋】
{git_diff}
"""

                commit_res = self.client.models.generate_content(
                    model=self.current_model,
                    contents=prompt
                )

                raw_text = commit_res.text.strip() if commit_res.text else "update: 機能更新"
                valid_lines = [line.strip().replace('"', '').replace('`', '') for line in raw_text.splitlines() if line.strip()]
                commit_msg = valid_lines[0] if valid_lines else "update: 機能更新"

                for prefix in ["コミットメッセージ:", "コミットメッセージ：", "Commit Message:", ">"]:
                    if commit_msg.startswith(prefix):
                        commit_msg = commit_msg[len(prefix):].strip()

                subprocess.run(["git", "commit", "-m", commit_msg], check=True)
                self.window.evaluate_js(f"window.appendSystemLog({json.dumps(f'✅ Gitコミット完了: {commit_msg}')})")

                time.sleep(1.2)
                self.window.destroy()
            except Exception as e:
                err_msg = f"⚠️ 終了処理エラー: {str(e)}"
                try:
                    self.window.evaluate_js(f"window.appendSystemLog({json.dumps(err_msg)})")
                except Exception:
                    pass

        threading.Thread(target=worker, daemon=True).start()
        return "processing"

# ==========================================
# 4. HTML/CSS/JS (UIデザイン)
# ==========================================
MODEL_OPTIONS_HTML = "".join(
    f'<option value="{m["id"]}">{m["name"]}</option>' for m in AVAILABLE_MODELS
)

INITIAL_GREETING_HTML = f"""こんにちは！<b>{PROJECT_NAME}</b> 専属Webリードエンジニアです。
以下の【厳格遵守ルール】に従って安全に開発作業を行います。

🛡️ <b>厳格遵守ルール</b>
1. <b>指示外のコード・機能・UI改変の絶対禁止</b>: 指示された場所以外のコード、既存機能（手書き・OCR・KanjiVG・Audio・判定等）、画面レイアウト・デザインを勝手に改変・削除せず、100%保持してマージします。
2. <b>省略コメントの禁止</b>: <code>// ...既存のコード...</code> 等の省略を使わず完全なコードを書き出します。
3. <b>1ターン最大2ファイル制限</b>: 無制限なファイル読み込み暴走を防ぎ、着実にステップ実行します。
4. <b>HANDOVERの独立管理</b>: 通常作業中に仕様書を乱雑に更新せず、専用ボタンから安全に最新化します。"""

HTML_CONTENT = f"""
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-user-select: text; user-select: text; }}
  body {{ display: flex; flex-direction: column; height: 100vh; background: #1e1e24; color: #e0e0e0; overflow: hidden; }}
  
  header {{ height: 50px; background: #2b2b36; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid #3d3d4d; flex-shrink: 0; -webkit-user-select: none; user-select: none; }}
  .header-left {{ display: flex; align-items: center; gap: 12px; }}
  .title {{ font-weight: bold; font-size: 14px; color: #fff; }}
  .model-select {{ background: #1a1a22; color: #4da3ff; border: 1px solid #444; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-weight: bold; outline: none; cursor: pointer; }}
  
  .token-monitor {{ display: flex; gap: 10px; font-size: 11px; background: #1a1a22; padding: 4px 10px; border-radius: 6px; border: 1px solid #3d3d4d; }}
  .token-stat {{ color: #aaa; }}
  .token-stat b {{ color: #00ff66; }}
  .token-warning {{ color: #ff4d4f !important; font-weight: bold; }}

  .btn-group {{ display: flex; gap: 8px; }}
  button {{ padding: 6px 14px; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: 0.2s; -webkit-user-select: none; user-select: none; }}
  .btn-run {{ background: #28a745; color: #fff; }}
  .btn-handover {{ background: #6f42c1; color: #fff; }}
  .btn-finder {{ background: #17a2b8; color: #fff; }}
  .btn-exit {{ background: #6c757d; color: #fff; }}
  button:hover {{ opacity: 0.85; }}

  .container {{ display: flex; flex: 1; overflow: hidden; width: 100%; }}
  .column {{ flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; height: 100%; border-right: 1px solid #3d3d4d; }}
  .column:last-child {{ border-right: none; }}

  .chat-history {{ flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }}
  .msg {{ max-width: 90%; padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; cursor: text; }}
  .msg-user {{ align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 2px; }}
  .msg-user .attachment-item-preview {{ margin-top: 6px; }}
  .msg-user img {{ max-width: 100%; border-radius: 6px; display: block; margin-top: 4px; }}
  .msg-user .file-badge {{ display: inline-block; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 4px; margin-right: 4px; }}
  .msg-ai {{ align-self: flex-start; background: #323242; color: #f1f1f1; border-bottom-left-radius: 2px; }}
  .msg-ai code {{ background: #1e1e28; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 12px; }}
  .msg-meta {{ font-size: 10px; color: #888; margin-top: 4px; text-align: right; }}

  .attachment-preview-box {{ display: none; padding: 8px 16px; background: #1a1a22; border-top: 1px solid #3d3d4d; flex-wrap: wrap; gap: 8px; max-height: 120px; overflow-y: auto; flex-shrink: 0; }}
  .attachment-tag {{ display: flex; align-items: center; gap: 6px; background: #2b2b36; border: 1px solid #444; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #ddd; max-width: 100%; }}
  .attachment-tag img {{ height: 28px; width: 28px; object-fit: cover; border-radius: 3px; }}
  .attachment-tag-name {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }}
  .btn-remove-single {{ background: none; border: none; color: #ff4d4f; font-weight: bold; cursor: pointer; padding: 0 4px; font-size: 14px; }}

  .chat-input-area {{ padding: 12px 16px; background: #252530; display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid #3d3d4d; flex-shrink: 0; }}
  textarea#userInput {{ flex: 1; height: 64px; padding: 10px 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a22; color: #fff; font-size: 14px; line-height: 1.4; resize: none; outline: none; min-width: 0; }}
  textarea#userInput:focus {{ border-color: #007aff; }}
  .btn-attach {{ height: 64px; width: 44px; background: #3a3a4c; color: #aaa; border-radius: 6px; font-size: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }}
  .btn-attach:hover {{ color: #fff; background: #4a4a5e; }}
  .btn-send {{ height: 64px; width: 70px; background: #007aff; color: #fff; border-radius: 6px; font-weight: bold; flex-shrink: 0; }}

  .right-header {{ padding: 10px 16px; background: #252530; font-size: 13px; font-weight: bold; border-bottom: 1px solid #3d3d4d; flex-shrink: 0; -webkit-user-select: none; user-select: none; }}
  .log-container {{ height: 180px; padding: 10px 16px; overflow-y: auto; background: #1a1a22; border-bottom: 1px solid #3d3d4d; font-family: monospace; font-size: 12px; flex-shrink: 0; }}
  .log-item {{ margin-bottom: 6px; padding: 4px 6px; border-radius: 4px; background: #282836; word-break: break-word; }}
  .log-file {{ color: #4da3ff; cursor: pointer; text-decoration: underline; font-weight: bold; }}
  
  .code-viewer-title {{ padding: 8px 16px; background: #252530; font-size: 12px; color: #aaa; border-bottom: 1px solid #3d3d4d; flex-shrink: 0; -webkit-user-select: none; user-select: none; }}
  .code-container {{ flex: 1; padding: 14px; overflow: auto; background: #121217; color: #98c379; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace; font-size: 13px; line-height: 1.4; white-space: pre; min-width: 0; }}
</style>
</head>
<body>

<header>
  <div class="header-left">
    <div class="title">🌐 {PROJECT_NAME} (Web Dev Studio)</div>
    <select class="model-select" onchange="onModelChange(this.value)">
      {MODEL_OPTIONS_HTML}
    </select>
    <div class="token-monitor">
      <div class="token-stat">累計: <b id="totalTokens">0</b> tok</div>
      <div class="token-stat">直近60秒: <b id="tpmTokens">0</b> / 250k</div>
    </div>
  </div>
  <div class="btn-group">
    <button class="btn-run" onclick="pywebview.api.open_web_app()">▶ ブラウザで開く (:{PORT})</button>
    <button class="btn-handover" onclick="pywebview.api.update_handover_doc()">📑 HANDOVER更新</button>
    <button class="btn-finder" onclick="pywebview.api.open_in_finder()">📂 Finderで表示</button>
    <button class="btn-exit" onclick="pywebview.api.exit_and_commit()">📝 終了 & Gitコミット</button>
  </div>
</header>

<div class="container">
  <div class="column">
    <div class="chat-history" id="chatHistory">
      <div class="msg msg-ai">{INITIAL_GREETING_HTML}</div>
    </div>

    <div class="attachment-preview-box" id="attachmentPreviewBox"></div>

    <div class="chat-input-area">
      <input type="file" id="fileInput" style="display: none;" multiple onchange="handleFileSelect(event)">
      <button class="btn-attach" title="ファイル/画像を複数添付" onclick="document.getElementById('fileInput').click()">📎</button>
      <textarea id="userInput" placeholder="修正指示を入力... (Enterで改行 / Cmd+Vで画像貼付 / Cmd+Enterで送信)"></textarea>
      <button class="btn-send" onclick="sendPrompt()">送信</button>
    </div>
  </div>

  <div class="column">
    <div class="right-header">🛠️ 更新・読み込みログ（クリックでコードを表示）</div>
    <div class="log-container" id="logContainer"></div>
    <div class="code-viewer-title" id="codeViewerTitle">📄 ファイルプレビュー</div>
    <pre class="code-container" id="codeContent">// ファイルをクリックすると最新のコードが表示されます</pre>
  </div>
</div>

<script>
  let attachedFiles = [];

  function onModelChange(newModel) {{
    pywebview.api.switch_model(newModel).then(res => {{
      window.appendSystemLog(`🔄 ${{res}}`);
    }});
  }}

  window.updateTokenStats = function(total, tpm) {{
    document.getElementById("totalTokens").innerText = total.toLocaleString();
    const tpmEl = document.getElementById("tpmTokens");
    tpmEl.innerText = tpm.toLocaleString();
    if (tpm > 200000) {{
      tpmEl.className = "token-warning";
    }} else {{
      tpmEl.className = "";
    }}
  }};

  setInterval(() => {{
    if (window.pywebview && pywebview.api && pywebview.api.get_current_tpm) {{
      pywebview.api.get_current_tpm().then(([total, tpm]) => {{
        window.updateTokenStats(total, tpm);
      }}).catch(() => {{}});
    }}
  }}, 1000);

  document.getElementById("userInput").addEventListener("paste", function(e) {{
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {{
      const item = items[index];
      if (item.kind === 'file' && item.type.startsWith('image/')) {{
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = function(event) {{
          attachedFiles.push({{
            type: 'image',
            name: `貼り付け画像_${{attachedFiles.length + 1}}.png`,
            base64: event.target.result
          }});
          renderAttachmentPreviews();
        }};
        reader.readAsDataURL(blob);
      }}
    }}
  }});

  function handleFileSelect(e) {{
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    let processedCount = 0;
    files.forEach(file => {{
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {{
        reader.onload = function(event) {{
          attachedFiles.push({{
            type: 'image',
            name: file.name,
            base64: event.target.result
          }});
          processedCount++;
          if (processedCount === files.length) renderAttachmentPreviews();
        }};
        reader.readAsDataURL(file);
      }} else {{
        reader.onload = function(event) {{
          attachedFiles.push({{
            type: 'text',
            name: file.name,
            content: event.target.result
          }});
          processedCount++;
          if (processedCount === files.length) renderAttachmentPreviews();
        }};
        reader.readAsText(file);
      }}
    }});
    e.target.value = "";
  }}

  function renderAttachmentPreviews() {{
    const box = document.getElementById("attachmentPreviewBox");
    if (attachedFiles.length === 0) {{
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }}

    box.style.display = "flex";
    box.innerHTML = attachedFiles.map((f, idx) => `
      <div class="attachment-tag">
        ${{f.type === 'image' ? `<img src="${{f.base64}}">` : `📄`}}
        <span class="attachment-tag-name" title="${{escapeHtml(f.name)}}">${{escapeHtml(f.name)}}</span>
        <button class="btn-remove-single" onclick="removeAttachment(${{idx}})">×</button>
      </div>
    `).join('');
  }}

  function removeAttachment(index) {{
    attachedFiles.splice(index, 1);
    renderAttachmentPreviews();
  }}

  function clearAllAttachments() {{
    attachedFiles = [];
    renderAttachmentPreviews();
  }}

  document.getElementById("userInput").addEventListener("keydown", function(e) {{
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {{
      e.preventDefault();
      sendPrompt();
    }}
  }});

  function sendPrompt() {{
    const input = document.getElementById("userInput");
    const text = input.value.trim();
    if (!text && attachedFiles.length === 0) return;
    
    const history = document.getElementById("chatHistory");
    let userMsgHtml = `<div class="msg msg-user">`;
    
    if (attachedFiles.length > 0) {{
      userMsgHtml += `<div class="attachment-item-preview">`;
      attachedFiles.forEach(f => {{
        if (f.type === 'image') {{
          userMsgHtml += `<img src="${{f.base64}}">`;
        }} else {{
          userMsgHtml += `<div class="file-badge">📄 ${{escapeHtml(f.name)}} (${{f.content.length}}文字)</div>`;
        }}
      }});
      userMsgHtml += `</div><br>`;
    }}

    userMsgHtml += escapeHtml(text);
    userMsgHtml += `</div>`;

    history.innerHTML += userMsgHtml;
    history.scrollTop = history.scrollHeight;
    
    const sendAttachments = [...attachedFiles];

    input.value = "";
    clearAllAttachments();

    pywebview.api.send_message(text, sendAttachments);
  }}

  window.appendAssistantMessage = function(text, tokens, elapsed) {{
    const history = document.getElementById("chatHistory");
    let meta = "";
    if (tokens > 0) {{
      meta = `<div class="msg-meta">⏱️ ${{elapsed}}s | 🪙 ${{tokens.toLocaleString()}} tok</div>`;
    }}
    history.innerHTML += `<div class="msg msg-ai">${{escapeHtml(text)}}${{meta}}</div>`;
    history.scrollTop = history.scrollHeight;
  }};

  window.onFileUpdated = function(filepath, summary) {{
    const logBox = document.getElementById("logContainer");
    const timeStr = new Date().toLocaleTimeString();
    const item = `
      <div class="log-item">
        ⚡ [${{timeStr}}] <span class="log-file" onclick="previewFile('${{filepath}}')">${{filepath}}</span> を自動更新<br>
        💡 <b>修正内容:</b> ${{escapeHtml(summary)}}
      </div>
    `;
    logBox.innerHTML = item + logBox.innerHTML;
    previewFile(filepath);
  }};

  window.appendSystemLog = function(msg) {{
    const logBox = document.getElementById("logContainer");
    logBox.innerHTML = `<div class="log-item" style="color: #ffca28;">${{escapeHtml(msg)}}</div>` + logBox.innerHTML;
  }};

  function previewFile(filepath) {{
    document.getElementById("codeViewerTitle").innerText = "📄 ファイルプレビュー: " + filepath;
    pywebview.api.get_file_content(filepath).then(code => {{
      document.getElementById("codeContent").innerText = code;
    }});
  }}

  function escapeHtml(str) {{
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }}
</script>

</body>
</html>
"""

# ==========================================
# 5. アプリケーション起動
# ==========================================
if __name__ == "__main__":
    api = UniversalStudioAPI()
    window = webview.create_window(
        title=f"AI Studio - {PROJECT_NAME} (Web Dev Mode)",
        html=HTML_CONTENT,
        width=1280,
        height=960,
        resizable=True,
        js_api=api
    )
    api.set_window(window)
    webview.start(debug=False)