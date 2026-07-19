#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web UI for the personal bid writing Agent."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List

import biaoshu_agent as agent

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "web"
MAX_UPLOAD_MB = 80
IS_VERCEL = bool(os.environ.get("VERCEL"))


@dataclass
class UploadedFile:
    filename: str
    data: bytes


def json_bytes(data: Dict[str, Any], status: str = "ok") -> bytes:
    payload = {"status": status, **data}
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def safe_inside(path: Path, base: Path = ROOT) -> Path:
    resolved = path.resolve()
    if base.resolve() not in [resolved, *resolved.parents]:
        raise ValueError("路径不在项目目录内")
    return resolved


def clean_filename(name: str) -> str:
    name = Path(name or "upload.bin").name
    return agent.sanitize_name(name.replace(" ", "_"))


def save_upload(field: UploadedFile | None, dest_dir: Path) -> Path | None:
    if not field or not field.filename:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = clean_filename(field.filename)
    suffix = Path(field.filename).suffix
    if suffix and not filename.endswith(suffix):
        filename += suffix
    dest = dest_dir / filename
    dest.write_bytes(field.data)
    return dest


def list_projects() -> List[Dict[str, Any]]:
    output_root = agent.DIRS["outputs"]
    projects: List[Dict[str, Any]] = []
    if not output_root.exists():
        return projects
    for project_dir in sorted(output_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not project_dir.is_dir():
            continue
        files = {p.name: p for p in project_dir.iterdir() if p.is_file()}
        projects.append(
            {
                "name": project_dir.name,
                "updated_at": project_dir.stat().st_mtime,
                "files": [
                    {
                        "name": name,
                        "path": str(path.relative_to(ROOT)),
                        "size": path.stat().st_size,
                    }
                    for name, path in sorted(files.items())
                ],
                "has_docx": "完整标书.docx" in files,
                "has_report": "04_合规检查报告.md" in files,
                "task": read_json_file(project_dir / "任务状态.json", {}),
            }
        )
    return projects


def read_project_text(project: str, filename: str) -> str:
    path = safe_inside(agent.DIRS["outputs"] / project / filename)
    if not path.exists() or path.suffix.lower() not in {".md", ".txt", ".json"}:
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def read_project_json(project: str, filename: str, default: Any) -> Any:
    path = safe_inside(agent.DIRS["outputs"] / project / filename)
    return read_json_file(path, default)


def read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def library_store_path() -> Path:
    return agent.DIRS["company"] / "资料库.json"


def config_path() -> Path:
    return ROOT / "agent_config.json"


def secrets_path() -> Path:
    return ROOT / ".agent_secrets.json"


def public_settings() -> Dict[str, Any]:
    settings = read_json_file(config_path(), {})
    key = "" if IS_VERCEL else read_json_file(secrets_path(), {}).get("api_key", "")
    settings["api_key"] = ("*" * 8 + key[-4:]) if key else ""
    settings["has_api_key"] = bool(key)
    settings["storage_mode"] = "browser" if IS_VERCEL else "server"
    return settings


def model_chat_endpoints(api_base: str) -> List[str]:
    """Return OpenAI-compatible chat endpoints, accepting either a root URL or /v1 base."""
    base = api_base.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return [base]
    parsed = urllib.parse.urlparse(base)
    if not parsed.path.strip("/"):
        return [f"{base}/v1/chat/completions", f"{base}/chat/completions"]
    return [f"{base}/chat/completions"]


def task_path(project: str) -> Path:
    return safe_inside(agent.DIRS["outputs"] / project / "任务状态.json")


def update_task(project: str, phase: str, progress: int, message: str, status: str = "running") -> Dict[str, Any]:
    state = read_json_file(task_path(project), {})
    now = datetime.now().isoformat(timespec="seconds")
    state.update({"project": project, "status": status, "phase": phase, "progress": progress, "message": message, "updated_at": now})
    history = state.setdefault("history", [])
    history.append({"phase": phase, "progress": progress, "message": message, "at": now})
    state["history"] = history[-30:]
    write_json_file(task_path(project), state)
    return state


def library_assets() -> Dict[str, List[Dict[str, Any]]]:
    groups = {
        "licenses": agent.DIRS["company"] / "证照附件",
        "company": agent.DIRS["company"] / "企业附件",
        "legal": agent.DIRS["company"] / "法人附件",
        "people": agent.DIRS["company"] / "人员附件",
        "certs": agent.DIRS["certs"],
        "cases": agent.DIRS["cases"],
        "history": agent.DIRS["history"],
        "templates": agent.DIRS["templates"],
    }
    result: Dict[str, List[Dict[str, Any]]] = {}
    for key, directory in groups.items():
        files: List[Dict[str, Any]] = []
        if directory.exists():
            for path in sorted(directory.rglob("*"), key=lambda p: p.stat().st_mtime if p.is_file() else 0, reverse=True):
                if path.is_file():
                    files.append({
                        "name": path.name,
                        "path": str(path.relative_to(ROOT)),
                        "size": path.stat().st_size,
                        "updated_at": path.stat().st_mtime,
                    })
        result[key] = files
    return result


def library_payload() -> Dict[str, Any]:
    data = read_json_file(library_store_path(), {})
    data.setdefault("company", {})
    data.setdefault("legal", {})
    data.setdefault("people", [])
    data.setdefault("cases", [])
    data.setdefault("certs", [])
    data.setdefault("templates", [])
    data["assets"] = library_assets()
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "BiaoshuAgent/1.0"

    def do_GET(self) -> None:
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path == "/":
                self.send_file(STATIC / "index.html", "text/html; charset=utf-8")
                return
            if path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if path.startswith("/web/"):
                file_path = safe_inside(ROOT / path.lstrip("/"))
                self.send_file(file_path)
                return
            if path == "/api/projects":
                self.send_json({"projects": list_projects()})
                return
            if path == "/api/project":
                query = urllib.parse.parse_qs(parsed.query)
                project = query.get("name", [""])[0]
                self.ensure_project_chapters(project)
                self.send_json(
                    {
                        "project": project,
                        "analysis": read_project_text(project, "01_招标文件解读.json"),
                        "outline": read_project_text(project, "02_投标目录.md"),
                        "draft": read_project_text(project, "03_标书初稿.md"),
                        "report": read_project_text(project, "04_合规检查报告.md"),
                        "source": read_project_text(project, "招标文件全文.txt"),
                        "chapters": read_project_json(project, "05_章节正文.json", []),
                        "review": read_project_json(project, "07_升级版审查问题单.json", {}),
                        "format_check": read_project_json(project, "08_导出格式检查.json", {}),
                        "task": read_project_json(project, "任务状态.json", {}),
                    }
                )
                return
            if path == "/api/library":
                self.send_json({"library": library_payload()})
                return
            if path == "/api/settings":
                self.send_json({"settings": public_settings()})
                return
            if path == "/api/knowledge-index":
                self.send_json({"index": agent.load_knowledge_index()})
                return
            if path == "/download":
                query = urllib.parse.parse_qs(parsed.query)
                rel = query.get("path", [""])[0]
                file_path = safe_inside(ROOT / rel)
                self.send_file(file_path, as_attachment=True)
                return
            self.send_error(404, "Not found")
        except Exception as exc:
            self.send_error_json(500, str(exc))

    def do_POST(self) -> None:
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path == "/api/library":
                self.handle_library_save()
                return
            if path == "/api/library/upload":
                self.handle_library_upload()
                return
            if path == "/api/settings":
                self.handle_settings_save()
                return
            if path == "/api/model-chat":
                self.handle_model_chat()
                return
            if path == "/api/knowledge-index":
                self.handle_knowledge_rebuild()
                return
            if path == "/api/check-bids":
                self.handle_check_bids()
                return
            if path == "/api/generate-chapter":
                self.handle_generate_chapter()
                return
            if path == "/api/save-chapter":
                self.handle_save_chapter()
                return
            if path == "/api/run-review":
                self.handle_run_review()
                return
            if path == "/api/export-final":
                self.handle_export_final()
                return
            if path != "/api/run":
                self.send_error(404, "Not found")
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length > MAX_UPLOAD_MB * 1024 * 1024:
                self.send_error_json(413, f"上传文件总大小超过 {MAX_UPLOAD_MB}MB")
                return
            form = self.parse_multipart(length)
            tender = save_upload(form.get("tender", [None])[0], agent.DIRS["tenders"])
            if not tender:
                self.send_error_json(400, "请上传招标文件")
                return
            self.save_optional_uploads(form, "company", agent.DIRS["company"])
            self.save_optional_uploads(form, "certs", agent.DIRS["certs"])
            self.save_optional_uploads(form, "cases", agent.DIRS["cases"])
            self.save_optional_uploads(form, "history", agent.DIRS["history"])
            self.save_optional_uploads(form, "templates", agent.DIRS["templates"])

            analysis, out_dir = agent.analyze_tender(tender)
            project = out_dir.name
            update_task(project, "analyze", 20, "招标文件结构化解读完成")
            agent.build_knowledge_index()
            update_task(project, "index", 35, "知识库分段索引完成")
            agent.make_outline(analysis, out_dir)
            update_task(project, "outline", 50, "投标目录生成完成")
            agent.draft_bid(analysis, out_dir)
            agent.generate_chapters(analysis, out_dir)
            update_task(project, "chapters", 75, "章节检索与生成完成")
            agent.compliance_check(analysis, out_dir / "03_标书初稿.md", out_dir)
            update_task(project, "review", 88, "基础合规检查完成")
            docx = agent.export_chapters_docx(out_dir, agent.find_template())
            agent.export_format_check(out_dir, docx)
            update_task(project, "complete", 100, "标书已生成，可继续编辑或导出", "completed")
            self.send_json(
                {
                    "project": out_dir.name,
                    "out_dir": str(out_dir.relative_to(ROOT)),
                    "docx": str(docx.relative_to(ROOT)),
                    "projects": list_projects(),
                }
            )
        except Exception as exc:
            traceback.print_exc()
            self.send_error_json(500, str(exc))

    def ensure_project_chapters(self, project: str) -> None:
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        analysis_path = out_dir / "01_招标文件解读.json"
        chapters_path = out_dir / "05_章节正文.json"
        if analysis_path.exists():
            analysis = read_json_file(analysis_path, {})
            if analysis and ("material_items" not in analysis or "timeline_items" not in analysis):
                sections = analysis.get("sections", {})
                structured = analysis.get("structured", {})
                analysis["material_items"] = agent.build_material_items(sections, structured)
                analysis["timeline_items"] = agent.build_timeline_items(structured, sections)
                write_json_file(analysis_path, analysis)
            if analysis and not chapters_path.exists():
                agent.generate_chapters(analysis, out_dir)

    def handle_library_save(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        current = read_json_file(library_store_path(), {})
        section = data.get("section") or "company"
        payload = data.get("data") or {}
        if section not in {"company", "legal", "people", "cases", "certs", "templates"}:
            self.send_error_json(400, "不支持的资料库分区")
            return
        if section in {"people", "cases", "certs", "templates"}:
            existing = current.get(section, [])
            if not isinstance(existing, list):
                existing = [existing] if existing else []
            incoming = payload if isinstance(payload, list) else [payload]
            for item in incoming:
                if isinstance(item, dict) and any(str(value).strip() for value in item.values()):
                    existing.append(item)
            current[section] = existing
        else:
            current[section] = payload
        write_json_file(library_store_path(), current)
        agent.write_library_markdown(current)
        index = agent.build_knowledge_index()
        self.send_json({"library": library_payload(), "index": index})

    def handle_library_upload(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > MAX_UPLOAD_MB * 1024 * 1024:
            self.send_error_json(413, f"上传文件总大小超过 {MAX_UPLOAD_MB}MB")
            return
        form = self.parse_multipart(length)
        category = self.first_text(form, "category") or "licenses"
        destinations = {
            "licenses": agent.DIRS["company"] / "证照附件",
            "company": agent.DIRS["company"] / "企业附件",
            "legal": agent.DIRS["company"] / "法人附件",
            "people": agent.DIRS["company"] / "人员附件",
            "certs": agent.DIRS["certs"],
            "cases": agent.DIRS["cases"],
            "history": agent.DIRS["history"],
            "templates": agent.DIRS["templates"],
        }
        dest = destinations.get(category)
        if not dest:
            self.send_error_json(400, "不支持的上传分类")
            return
        saved = []
        for field in form.get("files", []):
            path = save_upload(field, dest)
            if path:
                saved.append(str(path.relative_to(ROOT)))
        index = agent.build_knowledge_index()
        self.send_json({"saved": saved, "library": library_payload(), "index": index})

    def handle_settings_save(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        current = read_json_file(config_path(), {})
        allowed = {"provider", "model", "api_base", "temperature", "max_tokens", "technical_bid_first"}
        for key in allowed:
            if key not in data:
                continue
            current[key] = data[key]
        current.setdefault("template_bookmark", agent.DEFAULT_TEMPLATE_BOOKMARK)
        api_key = str(data.get("api_key", ""))
        if IS_VERCEL:
            current["api_key"] = ""
            current["has_api_key"] = bool(api_key)
            current["storage_mode"] = "browser"
            self.send_json({"settings": current})
            return
        write_json_file(config_path(), current)
        if api_key and not api_key.startswith("********"):
            write_json_file(secrets_path(), {"api_key": api_key})
        self.send_json({"settings": public_settings()})

    def handle_model_chat(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        api_base = str(data.get("api_base", "")).strip().rstrip("/")
        api_key = str(data.get("api_key", "")).strip()
        model = str(data.get("model", "")).strip()
        messages = data.get("messages") or []
        if not api_base or not api_key or not model:
            self.send_error_json(400, "请先在模型设置中填写接口地址、模型名称和 API Key")
            return
        parsed = urllib.parse.urlparse(api_base)
        local_hosts = {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme not in {"https", "http"} or (parsed.scheme == "http" and parsed.hostname not in local_hosts):
            self.send_error_json(400, "线上模型接口必须使用 HTTPS")
            return
        if not isinstance(messages, list) or not messages:
            self.send_error_json(400, "请输入测试消息")
            return
        safe_messages = [
            {"role": item.get("role", "user"), "content": str(item.get("content", ""))[:12000]}
            for item in messages[-12:]
            if isinstance(item, dict) and item.get("role") in {"system", "user", "assistant"}
        ]
        payload = {
            "model": model,
            "messages": safe_messages,
            "temperature": float(data.get("temperature", 0.3)),
            "max_tokens": min(int(data.get("max_tokens", 1024)), 4096),
        }
        result = None
        last_http_error = None
        attempted_endpoints = model_chat_endpoints(api_base)
        for endpoint in attempted_endpoints:
            request = urllib.request.Request(
                endpoint,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    result = json.loads(response.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="ignore")[:1000]
                last_http_error = (exc.code, detail, endpoint)
                if exc.code != 404:
                    break
            except Exception as exc:
                self.send_error_json(502, f"模型连接失败：{exc}")
                return
        if result is None and last_http_error:
            code, detail, endpoint = last_http_error
            hint = "请检查接口地址是否为 OpenAI 兼容 API 根地址（通常以 /v1 结尾），并核对模型名称。" if code == 404 else "请检查 API Key、模型名称和服务商状态。"
            suffix = f"；服务端信息：{detail}" if detail else ""
            self.send_error_json(502, f"模型接口返回 {code}，请求地址：{endpoint}。{hint}{suffix}")
            return
        choices = result.get("choices") or []
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        if not content:
            self.send_error_json(502, "模型接口已响应，但没有返回可读取的对话内容")
            return
        self.send_json({
            "reply": content,
            "requested_model": model,
            "response_model": result.get("model") or model,
            "usage": result.get("usage") or {},
        })

    def handle_knowledge_rebuild(self) -> None:
        self.send_json({"index": agent.build_knowledge_index()})

    def handle_check_bids(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > MAX_UPLOAD_MB * 1024 * 1024:
            self.send_error_json(413, f"上传文件总大小超过 {MAX_UPLOAD_MB}MB")
            return
        form = self.parse_multipart(length)
        project = self.first_text(form, "project")
        if not project:
            self.send_error_json(400, "缺少项目名称")
            return
        dest = safe_inside(agent.DIRS["outputs"] / project / "审查标书")
        saved = []
        for field in form.get("files", []):
            if isinstance(field, UploadedFile):
                path = save_upload(field, dest)
                if path:
                    saved.append({
                        "name": path.name,
                        "path": str(path.relative_to(ROOT)),
                        "size": path.stat().st_size,
                    })
        self.send_json({"project": project, "saved": saved})

    def handle_generate_chapter(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        project = data.get("project") or ""
        chapter_id = data.get("chapter_id") or ""
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        analysis = read_json_file(out_dir / "01_招标文件解读.json", {})
        update_task(project, "chapter-retrieval", 55, f"正在为章节 {chapter_id or '全部'} 检索知识库")
        chapters = agent.generate_chapters(analysis, out_dir, only_id=chapter_id or None)
        task = update_task(project, "chapter-ready", 80, f"章节 {chapter_id or '全部'} 已生成，等待人工确认")
        self.send_json({"project": project, "chapters": chapters, "task": task})

    def handle_save_chapter(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        project = data.get("project") or ""
        chapter_id = data.get("chapter_id") or ""
        content = data.get("content") or ""
        if not project:
            self.send_error_json(400, "缺少项目名称")
            return
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        chapters = read_json_file(out_dir / "05_章节正文.json", [])
        for chapter in chapters:
            if chapter.get("id") == chapter_id:
                chapter["content"] = content
                break
        else:
            self.send_error_json(404, "未找到章节")
            return
        agent.save_chapters(out_dir, chapters)
        self.send_json({"project": project, "chapters": chapters})

    def handle_run_review(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        project = data.get("project") or ""
        if not project:
            self.send_error_json(400, "缺少项目名称")
            return
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        analysis = read_json_file(out_dir / "01_招标文件解读.json", {})
        chapters = read_json_file(out_dir / "05_章节正文.json", [])
        review = agent.upgraded_review(analysis, chapters, read_json_file(library_store_path(), {}))
        agent.write_review_report(review, out_dir)
        task = update_task(project, "review-ready", 92, "查重、模板残留和废标专项检查完成")
        self.send_json({"project": project, "review": review, "task": task})

    def handle_export_final(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        project = data.get("project") or ""
        if not project:
            self.send_error_json(400, "缺少项目名称")
            return
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        docx = agent.export_chapters_docx(out_dir, agent.find_template())
        format_check = agent.export_format_check(out_dir, docx)
        task = update_task(project, "complete", 100, "Word 已导出并完成格式检查", "completed")
        self.send_json({"project": project, "docx": str(docx.relative_to(ROOT)), "format_check": format_check, "task": task})

    def parse_multipart(self, length: int) -> Dict[str, List[Any]]:
        content_type = self.headers.get("Content-Type", "")
        body = self.rfile.read(length)
        raw = (
            f"Content-Type: {content_type}\r\n"
            "MIME-Version: 1.0\r\n\r\n"
        ).encode("utf-8") + body
        message = BytesParser(policy=default).parsebytes(raw)
        form: Dict[str, List[Any]] = {}
        if not message.is_multipart():
            return form
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            if not name:
                continue
            payload = part.get_payload(decode=True) or b""
            if filename:
                form.setdefault(name, []).append(UploadedFile(filename=filename, data=payload))
            else:
                form.setdefault(name, []).append(payload.decode("utf-8", errors="ignore"))
        return form

    def first_text(self, form: Dict[str, List[Any]], key: str) -> str:
        value = form.get(key, [""])[0]
        return value if isinstance(value, str) else ""

    def save_optional_uploads(self, form: Dict[str, List[Any]], key: str, dest: Path) -> None:
        for field in form.get(key, []):
            if isinstance(field, UploadedFile):
                save_upload(field, dest)

    def send_json(self, data: Dict[str, Any], status_code: int = 200) -> None:
        body = json_bytes(data)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status_code: int, message: str) -> None:
        body = json_bytes({"message": message}, status="error")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, file_path: Path, content_type: str | None = None, as_attachment: bool = False) -> None:
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, "File not found")
            return
        content_type = content_type or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if as_attachment:
            quoted = urllib.parse.quote(file_path.name)
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quoted}")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def run(host: str, port: int) -> None:
    agent.init_project()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"标书写作 Agent 已启动：http://{host}:{port}")
    server.serve_forever()


def main() -> int:
    parser = argparse.ArgumentParser(description="启动标书写作 Agent 网页版")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    run(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
