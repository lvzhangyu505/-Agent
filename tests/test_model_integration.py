import io
import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import web_app


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class FakeModelHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode())
        if payload.get("model") == "failing-model":
            body = json.dumps({"error": {"code": "model_unavailable", "message": "temporary failure"}}).encode()
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        prompt = "\n".join(item.get("content", "") for item in payload.get("messages", []))
        if "请解读下列招标文件" in prompt:
            content = json.dumps({
                "structured": {"project_name": "测试医院导医服务项目"},
                "evidence": {"project_name": "项目名称：测试医院导医服务项目"},
                "sections": {
                    "qualification": ["投标人须提供营业执照"],
                    "scoring": ["评分标准：服务方案10分"],
                },
            }, ensure_ascii=False)
        elif "请撰写章节" in prompt:
            content = "## 一、投标函及资格响应\n\n我方提供营业执照。\n\n### 待补充或人工确认事项\n- 【待补充：附件页码】"
        else:
            content = json.dumps({
                "issues": [{
                    "level": "中",
                    "location": "资格章节",
                    "requirement_source": "投标人须提供营业执照",
                    "bid_source": "我方提供营业执照",
                    "risk": "需确认附件页码",
                    "action": "补充营业执照附件索引",
                }]
            }, ensure_ascii=False)
        body = json.dumps({
            "model": "fake-model-actual",
            "choices": [{"message": {"content": content}}],
            "usage": {"total_tokens": 42},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class ModelIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.settings = {
            "provider": "openai-compatible",
            "model": "test-model",
            "api_base": "https://example.com/v1",
            "api_key": "sk-test-secret",
            "temperature": 0.3,
            "max_tokens": 1024,
        }

    def test_model_endpoint_normalization(self):
        self.assertEqual(
            web_app.model_chat_endpoints("https://example.com"),
            ["https://example.com/v1/chat/completions", "https://example.com/chat/completions"],
        )
        self.assertEqual(
            web_app.model_chat_endpoints("https://example.com/v1/chat/completions"),
            ["https://example.com/v1/chat/completions"],
        )

    def test_masked_key_is_not_ready(self):
        settings = {**self.settings, "api_key": "********abcd"}
        self.assertFalse(web_app.external_model_ready(settings))

    def test_chat_completion_result_and_usage(self):
        response = FakeResponse({
            "model": "actual-model",
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"total_tokens": 12},
        })
        with patch("web_app.urllib.request.urlopen", return_value=response):
            result = web_app.call_compatible_model(self.settings, [{"role": "user", "content": "test"}])
        self.assertEqual(result["content"], "ok")
        self.assertEqual(result["response_model"], "actual-model")
        self.assertEqual(result["usage"]["total_tokens"], 12)

    def test_unauthorized_error_does_not_echo_provider_detail(self):
        error = HTTPError(
            "https://example.com/v1/chat/completions",
            401,
            "Unauthorized",
            {},
            io.BytesIO(b'{"message":"bad key sk-secret-value"}'),
        )
        with patch("web_app.urllib.request.urlopen", side_effect=error):
            with self.assertRaises(web_app.ModelCallError) as raised:
                web_app.call_compatible_model(self.settings, [{"role": "user", "content": "test"}])
        self.assertNotIn("sk-secret-value", str(raised.exception))

    def test_analysis_only_accepts_exact_source_evidence(self):
        source = "项目名称：医院导医服务项目。投标人须具备独立法人资格。"
        analysis = {"sections": {key: [] for key in web_app.agent.KEYWORDS}, "structured": {}}
        ai = {
            "structured": {"project_name": "医院导医服务项目", "budget": "100万元"},
            "evidence": {"project_name": "项目名称：医院导医服务项目", "budget": "预算为100万元"},
            "sections": {
                "qualification": ["投标人须具备独立法人资格"],
                "rejection": ["未盖章一律废标"],
            },
        }
        merged = web_app.merge_ai_analysis(analysis, source, ai)
        self.assertEqual(merged["structured"]["project_name"], "医院导医服务项目")
        self.assertNotIn("budget", merged["structured"])
        self.assertIn("投标人须具备独立法人资格", merged["sections"]["qualification"])
        self.assertNotIn("未盖章一律废标", merged["sections"]["rejection"])

    def test_review_only_accepts_exact_quotes(self):
        review = {"issues": []}
        ai = {
            "issues": [
                {
                    "level": "高",
                    "location": "资格章节",
                    "requirement_source": "须提供营业执照",
                    "bid_source": "我方提供营业执照",
                    "risk": "证据不足",
                    "action": "补充附件索引",
                },
                {
                    "level": "高",
                    "requirement_source": "不存在的招标要求",
                    "bid_source": "我方提供营业执照",
                },
            ]
        }
        accepted = web_app.merge_ai_review(review, ai, "须提供营业执照", "我方提供营业执照")
        self.assertEqual(accepted, 1)
        self.assertEqual(review["summary"]["total"], 1)
        self.assertEqual(review["issues"][0]["rule"], "AI语义审查")

    def test_json_code_fence_is_parsed(self):
        self.assertEqual(web_app.parse_json_content('```json\n{"ok": true}\n```'), {"ok": True})


class FullFlowIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.runtime = tempfile.TemporaryDirectory(prefix=".test-ai-flow-", dir=web_app.ROOT)
        runtime_root = Path(self.runtime.name)
        self.original_dirs = web_app.agent.DIRS
        web_app.agent.DIRS = {
            "tenders": runtime_root / "招标文件",
            "company": runtime_root / "企业资料",
            "certs": runtime_root / "资质证书",
            "cases": runtime_root / "企业业绩",
            "history": runtime_root / "历史标书",
            "templates": runtime_root / "模板",
            "outputs": runtime_root / "输出标书",
        }
        web_app.agent.ensure_dirs()
        self.model_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeModelHandler)
        self.model_thread = threading.Thread(target=self.model_server.serve_forever, daemon=True)
        self.model_thread.start()
        self.app_server = ThreadingHTTPServer(("127.0.0.1", 0), web_app.Handler)
        self.app_thread = threading.Thread(target=self.app_server.serve_forever, daemon=True)
        self.app_thread.start()
        self.app_url = f"http://127.0.0.1:{self.app_server.server_port}"
        self.settings = {
            "provider": "openai-compatible",
            "model": "fake-model",
            "api_base": f"http://127.0.0.1:{self.model_server.server_port}/v1",
            "api_key": "sk-fake",
            "temperature": 0.3,
            "max_tokens": 1024,
        }

    def tearDown(self):
        self.app_server.shutdown()
        self.model_server.shutdown()
        self.app_server.server_close()
        self.model_server.server_close()
        web_app.agent.DIRS = self.original_dirs
        self.runtime.cleanup()

    def post_json(self, path, payload):
        request = urllib.request.Request(
            self.app_url + path,
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode())

    def post_tender(self, settings=None):
        settings = settings or self.settings
        boundary = "----BiaoshuTestBoundary"
        tender = "项目名称：测试医院导医服务项目\n投标人须提供营业执照\n评分标准：服务方案10分".encode()
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"model_settings\"\r\n\r\n{json.dumps(settings, ensure_ascii=False)}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"tender\"; filename=\"测试招标文件.txt\"\r\nContent-Type: text/plain\r\n\r\n".encode() + tender + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        request = urllib.request.Request(
            self.app_url + "/api/run",
            data=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())

    def test_upload_chapter_review_and_call_log(self):
        uploaded = self.post_tender()
        self.assertEqual(uploaded["model_call"]["status"], "success")
        project = uploaded["project"]
        chapter = self.post_json("/api/generate-chapter", {
            "project": project,
            "chapter_id": "letter",
            "model_settings": self.settings,
        })
        self.assertEqual(chapter["model_call"]["status"], "success")
        generated = next(item for item in chapter["chapters"] if item.get("id") == "letter")
        self.assertIn("我方提供营业执照", generated["content"])
        reviewed = self.post_json("/api/run-review", {
            "project": project,
            "model_settings": self.settings,
        })
        self.assertEqual(reviewed["model_call"]["status"], "success")
        self.assertTrue(any(item.get("rule") == "AI语义审查" for item in reviewed["review"]["issues"]))
        calls_path = web_app.agent.DIRS["outputs"] / project / "09_AI调用记录.json"
        calls = json.loads(calls_path.read_text(encoding="utf-8"))
        self.assertEqual([item["stage"] for item in calls], ["智能解读", "标书章节生成", "合规语义审查"])

    def test_model_failures_are_explicit_fallbacks(self):
        uploaded = self.post_tender()
        project = uploaded["project"]
        failing = {**self.settings, "model": "failing-model"}
        chapter = self.post_json("/api/generate-chapter", {
            "project": project,
            "chapter_id": "letter",
            "model_settings": failing,
        })
        self.assertEqual(chapter["model_call"]["status"], "fallback")
        self.assertIn("AI 章节生成失败", chapter["task"]["message"])
        reviewed = self.post_json("/api/run-review", {
            "project": project,
            "model_settings": failing,
        })
        self.assertEqual(reviewed["model_call"]["status"], "fallback")
        self.assertIn("AI 语义审查失败", reviewed["task"]["message"])


if __name__ == "__main__":
    unittest.main()
