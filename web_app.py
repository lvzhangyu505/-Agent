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


class ModelCallError(RuntimeError):
    pass


def normalize_model_settings(value: Any) -> Dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    if not isinstance(value, dict):
        return {}
    return {
        "provider": str(value.get("provider", "local")).strip(),
        "model": str(value.get("model", "")).strip(),
        "api_base": str(value.get("api_base", "")).strip().rstrip("/"),
        "api_key": str(value.get("api_key", "")).strip(),
        "temperature": float(value.get("temperature", 0.3) or 0.3),
        "max_tokens": min(max(int(value.get("max_tokens", 4096) or 4096), 256), 128000),
    }


def external_model_ready(settings: Dict[str, Any]) -> bool:
    key = str(settings.get("api_key", ""))
    return (
        settings.get("provider") == "openai-compatible"
        and bool(settings.get("api_base"))
        and bool(settings.get("model"))
        and bool(key)
        and not key.startswith("****")
    )


def call_compatible_model(
    settings: Dict[str, Any],
    messages: List[Dict[str, str]],
    max_tokens: int | None = None,
) -> Dict[str, Any]:
    api_base = str(settings.get("api_base", "")).strip().rstrip("/")
    api_key = str(settings.get("api_key", "")).strip()
    model = str(settings.get("model", "")).strip()
    if not external_model_ready(settings):
        raise ModelCallError("外部模型设置不完整，请重新填写接口地址、模型名称和完整 API Key")
    parsed = urllib.parse.urlparse(api_base)
    local_hosts = {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme not in {"https", "http"} or (parsed.scheme == "http" and parsed.hostname not in local_hosts):
        raise ModelCallError("线上模型接口必须使用 HTTPS")
    safe_messages = [
        {"role": item.get("role", "user"), "content": str(item.get("content", ""))[:40000]}
        for item in messages[-12:]
        if isinstance(item, dict) and item.get("role") in {"system", "user", "assistant"}
    ]
    if not safe_messages:
        raise ModelCallError("模型请求缺少有效消息")
    payload = {
        "model": model,
        "messages": safe_messages,
        "temperature": float(settings.get("temperature", 0.3)),
        "max_tokens": min(max_tokens or int(settings.get("max_tokens", 4096)), 8192),
    }
    result = None
    last_http_error = None
    for endpoint in model_chat_endpoints(api_base):
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
            raise ModelCallError(f"模型连接失败：{exc}") from exc
    if result is None and last_http_error:
        code, detail, endpoint = last_http_error
        hint = "请检查接口地址和模型名称" if code in {404, 503} else "请检查 API Key、模型名称和服务商状态"
        safe_detail = "" if code in {401, 403} else detail
        suffix = f"；服务端信息：{safe_detail}" if safe_detail else ""
        raise ModelCallError(f"模型接口返回 {code}，请求地址：{endpoint}。{hint}{suffix}")
    choices = result.get("choices") or []
    content = choices[0].get("message", {}).get("content", "") if choices else ""
    if not isinstance(content, str) or not content.strip():
        raise ModelCallError("模型接口已响应，但没有返回可读取的对话内容")
    return {
        "content": content.strip(),
        "requested_model": model,
        "response_model": result.get("model") or model,
        "usage": result.get("usage") or {},
    }


def parse_json_content(content: str) -> Dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ModelCallError("模型未返回有效 JSON 对象")
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ModelCallError(f"模型返回的 JSON 无法解析：{exc.msg}") from exc
    if not isinstance(value, dict):
        raise ModelCallError("模型返回结果不是 JSON 对象")
    return value


def model_call_record(stage: str, status: str, settings: Dict[str, Any], **extra: Any) -> Dict[str, Any]:
    return {
        "stage": stage,
        "status": status,
        "source": "external_model" if status == "success" else ("local_rules" if status == "local" else "local_fallback"),
        "requested_model": settings.get("model", ""),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        **extra,
    }


def append_model_call(out_dir: Path, record: Dict[str, Any]) -> None:
    path = out_dir / "09_AI调用记录.json"
    records = read_json_file(path, [])
    if not isinstance(records, list):
        records = []
    records.append(record)
    write_json_file(path, records[-100:])


def merge_ai_analysis(analysis: Dict[str, Any], source_text: str, ai: Dict[str, Any]) -> Dict[str, Any]:
    sections = analysis.setdefault("sections", {})
    ai_sections = ai.get("sections") if isinstance(ai.get("sections"), dict) else {}
    for key in agent.KEYWORDS:
        values = ai_sections.get(key, [])
        if not isinstance(values, list):
            continue
        validated = [str(item).strip() for item in values if isinstance(item, str) and str(item).strip() in source_text]
        sections[key] = list(dict.fromkeys([*sections.get(key, []), *validated]))[:30]
    structured = analysis.setdefault("structured", {})
    ai_structured = ai.get("structured") if isinstance(ai.get("structured"), dict) else {}
    evidence = ai.get("evidence") if isinstance(ai.get("evidence"), dict) else {}
    allowed_fields = {"project_name", "project_no", "purchaser", "agency", "budget", "service_period", "bid_deadline", "bid_location"}
    accepted_evidence: Dict[str, str] = {}
    for key in allowed_fields:
        value = str(ai_structured.get(key, "")).strip()
        quote = str(evidence.get(key, "")).strip()
        if value and quote and quote in source_text:
            structured[key] = value
            accepted_evidence[key] = quote
    analysis["ai_evidence"] = accepted_evidence
    analysis["requirements"] = agent.build_requirement_items(sections)
    analysis["scoring_items"] = agent.build_scoring_items(sections.get("scoring", []))
    analysis["material_items"] = agent.build_material_items(sections, structured)
    analysis["timeline_items"] = agent.build_timeline_items(structured, sections)
    analysis["risks"] = agent.build_risks(sections)
    analysis["checklist"] = agent.build_checklist(sections)
    return analysis


def merge_ai_review(review: Dict[str, Any], ai: Dict[str, Any], tender_text: str, bid_text: str) -> int:
    items = ai.get("issues") if isinstance(ai.get("issues"), list) else []
    accepted = 0
    for item in items[:20]:
        if not isinstance(item, dict):
            continue
        requirement_source = str(item.get("requirement_source", "")).strip()
        bid_source = str(item.get("bid_source", "")).strip()
        if requirement_source and requirement_source not in tender_text:
            continue
        if bid_source and bid_source not in bid_text:
            continue
        if not requirement_source and not bid_source:
            continue
        level = str(item.get("level", "中")).strip()
        if level not in {"高", "中", "低"}:
            level = "中"
        review.setdefault("issues", []).append({
            "rule": "AI语义审查",
            "level": level,
            "status": "待人工复核",
            "location": str(item.get("location", "章节正文")).strip() or "章节正文",
            "requirement": requirement_source or "未引用招标原文",
            "current": bid_source or "标书中未找到明确响应原文",
            "risk": str(item.get("risk", "")).strip() or level,
            "action": str(item.get("action", "")).strip() or "人工核对招标原文并补充明确响应。",
            "reviewer": "AI初审，待人工复核",
        })
        accepted += 1
    issues = review.get("issues", [])
    review["summary"] = {
        "total": len(issues),
        "high": sum(1 for item in issues if item.get("level") == "高"),
        "medium": sum(1 for item in issues if item.get("level") == "中"),
        "low": sum(1 for item in issues if item.get("level") == "低"),
    }
    return accepted


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
                        "model_calls": read_project_json(project, "09_AI调用记录.json", []),
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
            model_settings = normalize_model_settings(self.first_text(form, "model_settings"))
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
            source_text = read_project_text(project, "招标文件全文.txt")
            if external_model_ready(model_settings):
                try:
                    result = call_compatible_model(
                        model_settings,
                        [
                            {
                                "role": "system",
                                "content": (
                                    "你是严谨的中国招投标文件解读助手。只能依据用户提供的招标原文，不得编造。"
                                    "输出一个 JSON 对象，不要输出 Markdown。sections 中的每一项必须逐字引用原文；"
                                    "structured 中的字段必须在 evidence 中给出逐字原文依据。"
                                ),
                            },
                            {
                                "role": "user",
                                "content": (
                                    "请解读下列招标文件，输出结构："
                                    '{"structured":{"project_name":"","project_no":"","purchaser":"","agency":"","budget":"","service_period":"","bid_deadline":"","bid_location":""},'
                                    '"evidence":{"字段名":"对应逐字原文"},'
                                    '"sections":{"project":[],"qualification":[],"rejection":[],"scoring":[],"business":[],"price":[],"format":[]}}。'
                                    "无法确认的字段留空。原文如下：\n" + source_text[:30000]
                                ),
                            },
                        ],
                        max_tokens=4096,
                    )
                    ai_analysis = parse_json_content(result["content"])
                    analysis = merge_ai_analysis(analysis, source_text, ai_analysis)
                    call_record = model_call_record(
                        "智能解读",
                        "success",
                        model_settings,
                        response_model=result["response_model"],
                        usage=result["usage"],
                        accepted_evidence=len(analysis.get("ai_evidence", {})),
                    )
                    update_task(project, "analyze", 20, f"智能解读完成，实际模型：{result['response_model']}")
                except ModelCallError as exc:
                    call_record = model_call_record("智能解读", "fallback", model_settings, error=str(exc))
                    update_task(project, "analyze", 20, f"AI 解读失败，已明确使用本地规则：{exc}")
            else:
                call_record = model_call_record("智能解读", "local", model_settings, error="未启用或未完整配置外部模型")
                update_task(project, "analyze", 20, "使用本地规则完成招标文件结构化解读")
            analysis["model_call"] = call_record
            write_json_file(out_dir / "01_招标文件解读.json", analysis)
            append_model_call(out_dir, call_record)
            agent.build_knowledge_index()
            update_task(project, "index", 35, "知识库分段索引完成")
            agent.make_outline(analysis, out_dir)
            update_task(project, "outline", 50, "投标目录生成完成")
            agent.draft_bid(analysis, out_dir)
            chapters = agent.generate_chapters(analysis, out_dir)
            for chapter in chapters:
                chapter["model_call"] = model_call_record("章节基线", "local", model_settings, error="等待按章节调用外部模型")
            agent.save_chapters(out_dir, chapters)
            update_task(project, "chapters", 75, "本地章节基线已生成，可按章节调用外部模型")
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
                    "model_call": call_record,
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
        settings = normalize_model_settings(data)
        messages = data.get("messages") or []
        if not isinstance(messages, list) or not messages:
            self.send_error_json(400, "请输入测试消息")
            return
        try:
            result = call_compatible_model(settings, messages, max_tokens=int(data.get("max_tokens", 1024)))
        except ModelCallError as exc:
            self.send_error_json(502, str(exc))
            return
        self.send_json({"reply": result["content"], **{key: value for key, value in result.items() if key != "content"}})

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
        model_settings = normalize_model_settings(data.get("model_settings"))
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        analysis = read_json_file(out_dir / "01_招标文件解读.json", {})
        update_task(project, "chapter-retrieval", 55, f"正在为章节 {chapter_id or '全部'} 检索知识库")
        chapters = agent.generate_chapters(analysis, out_dir, only_id=chapter_id or None)
        target = next((item for item in chapters if item.get("id") == chapter_id), None)
        if target and external_model_ready(model_settings):
            try:
                requirement_context = json.dumps(target.get("requirements", [])[:12], ensure_ascii=False)
                knowledge_context = json.dumps(target.get("knowledge_refs", [])[:6], ensure_ascii=False)
                structured_context = json.dumps(analysis.get("structured", {}), ensure_ascii=False)
                result = call_compatible_model(
                    model_settings,
                    [
                        {
                            "role": "system",
                            "content": (
                                "你是中国医疗机构服务项目投标文件撰写助手。只能使用提供的招标要求和知识库资料。"
                                "不得编造公司资质、业绩、人员、金额、证书、响应时限或承诺；缺失信息写【待补充：具体信息】。"
                                "输出可直接进入 Word 的正式 Markdown 章节，并保留可复核的原文依据。"
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"请撰写章节《{target.get('title', '')}》，章节类型：{target.get('kind', '')}。\n"
                                f"项目结构化信息：{structured_context}\n"
                                f"招标原文要求：{requirement_context}\n"
                                f"企业资料/历史标书检索片段：{knowledge_context}\n"
                                "要求：以“## 章节标题”开头；逐条响应招标要求；引用企业材料时标注来源路径；"
                                "不得把未知信息写成事实；结尾列出“待补充或人工确认事项”。"
                            ),
                        },
                    ],
                    max_tokens=min(int(model_settings.get("max_tokens", 4096)), 8192),
                )
                target["content"] = result["content"]
                call_record = model_call_record(
                    "标书章节生成",
                    "success",
                    model_settings,
                    response_model=result["response_model"],
                    usage=result["usage"],
                    chapter_id=chapter_id,
                    chapter_title=target.get("title", ""),
                )
                target["model_call"] = call_record
                agent.save_chapters(out_dir, chapters)
                append_model_call(out_dir, call_record)
                task = update_task(project, "chapter-ready", 80, f"本章由 {result['response_model']} 生成，等待人工确认")
            except ModelCallError as exc:
                call_record = model_call_record("标书章节生成", "fallback", model_settings, error=str(exc), chapter_id=chapter_id)
                target["model_call"] = call_record
                agent.save_chapters(out_dir, chapters)
                append_model_call(out_dir, call_record)
                task = update_task(project, "chapter-ready", 80, f"AI 章节生成失败，已明确保留本地规则基线：{exc}")
        else:
            call_record = model_call_record(
                "标书章节生成",
                "local",
                model_settings,
                error="未启用外部模型或未选择具体章节",
                chapter_id=chapter_id,
            )
            if target:
                target["model_call"] = call_record
                agent.save_chapters(out_dir, chapters)
            append_model_call(out_dir, call_record)
            task = update_task(project, "chapter-ready", 80, "本章使用本地规则基线，未调用外部模型")
        self.send_json({"project": project, "chapters": chapters, "task": task, "model_call": call_record})

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
        model_settings = normalize_model_settings(data.get("model_settings"))
        if not project:
            self.send_error_json(400, "缺少项目名称")
            return
        out_dir = safe_inside(agent.DIRS["outputs"] / project)
        analysis = read_json_file(out_dir / "01_招标文件解读.json", {})
        chapters = read_json_file(out_dir / "05_章节正文.json", [])
        review = agent.upgraded_review(analysis, chapters, read_json_file(library_store_path(), {}))
        tender_text = read_project_text(project, "招标文件全文.txt")
        bid_text = agent.chapters_to_markdown(chapters)
        if external_model_ready(model_settings):
            try:
                result = call_compatible_model(
                    model_settings,
                    [
                        {
                            "role": "system",
                            "content": (
                                "你是严谨的中国招投标合规审查助手。先比较招标原文与投标正文，只报告有逐字证据的问题。"
                                "不得编造页码、资格、承诺或法规结论。输出 JSON 对象，不要输出 Markdown。"
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                '输出结构：{"issues":[{"level":"高|中|低","location":"章节名称",'
                                '"requirement_source":"招标文件逐字原文","bid_source":"投标正文逐字原文，可为空",'
                                '"risk":"风险说明","action":"具体修改动作"}]}。'
                                "重点检查资格、废标项、评分响应、商务条款、前后矛盾、模板残留和无依据承诺。"
                                f"\n\n招标原文：\n{tender_text[:22000]}"
                                f"\n\n投标正文：\n{bid_text[:22000]}"
                            ),
                        },
                    ],
                    max_tokens=4096,
                )
                ai_review = parse_json_content(result["content"])
                accepted = merge_ai_review(review, ai_review, tender_text, bid_text)
                call_record = model_call_record(
                    "合规语义审查",
                    "success",
                    model_settings,
                    response_model=result["response_model"],
                    usage=result["usage"],
                    accepted_issues=accepted,
                )
                task = update_task(project, "review-ready", 92, f"规则审查 + {result['response_model']} 语义审查完成")
            except ModelCallError as exc:
                call_record = model_call_record("合规语义审查", "fallback", model_settings, error=str(exc))
                task = update_task(project, "review-ready", 92, f"AI 语义审查失败，已明确保留规则审查：{exc}")
        else:
            call_record = model_call_record("合规语义审查", "local", model_settings, error="未启用或未完整配置外部模型")
            task = update_task(project, "review-ready", 92, "仅完成确定性规则审查，未调用外部模型")
        review["model_call"] = call_record
        append_model_call(out_dir, call_record)
        agent.write_review_report(review, out_dir)
        self.send_json({"project": project, "review": review, "task": task, "model_call": call_record})

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
