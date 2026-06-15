#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web UI for the personal bid writing Agent."""

from __future__ import annotations

import argparse
import json
import mimetypes
import traceback
import urllib.parse
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List

import biaoshu_agent as agent

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "web"
MAX_UPLOAD_MB = 80


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
            }
        )
    return projects


def read_project_text(project: str, filename: str) -> str:
    path = safe_inside(agent.DIRS["outputs"] / project / filename)
    if not path.exists() or path.suffix.lower() not in {".md", ".txt", ".json"}:
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


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
                self.send_json(
                    {
                        "project": project,
                        "analysis": read_project_text(project, "01_招标文件解读.json"),
                        "outline": read_project_text(project, "02_投标目录.md"),
                        "draft": read_project_text(project, "03_标书初稿.md"),
                        "report": read_project_text(project, "04_合规检查报告.md"),
                    }
                )
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
            if self.path != "/api/run":
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
            agent.make_outline(analysis, out_dir)
            agent.draft_bid(analysis, out_dir)
            agent.compliance_check(analysis, out_dir / "03_标书初稿.md", out_dir)
            docx = agent.export_docx(out_dir / "03_标书初稿.md", out_dir / "完整标书.docx", agent.find_template())
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

    def parse_multipart(self, length: int) -> Dict[str, List[UploadedFile]]:
        content_type = self.headers.get("Content-Type", "")
        body = self.rfile.read(length)
        raw = (
            f"Content-Type: {content_type}\r\n"
            "MIME-Version: 1.0\r\n\r\n"
        ).encode("utf-8") + body
        message = BytesParser(policy=default).parsebytes(raw)
        form: Dict[str, List[UploadedFile]] = {}
        if not message.is_multipart():
            return form
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            if not name or not filename:
                continue
            payload = part.get_payload(decode=True) or b""
            form.setdefault(name, []).append(UploadedFile(filename=filename, data=payload))
        return form

    def save_optional_uploads(self, form: Dict[str, List[UploadedFile]], key: str, dest: Path) -> None:
        for field in form.get(key, []):
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
