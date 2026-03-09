"""
GitHub Issues Router

Attachment strategies:
  Text (.log/.txt/.csv/.json)  -> inline code block in issue body
  Everything else              -> saved to backend/issues/<title>/<filename>
                                  path noted in issue body
"""

import re
import os
from typing import Optional, List
from pathlib import Path

import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException

router = APIRouter(prefix="/github", tags=["github"])

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO  = "JawboneHealth/all.factory"
GITHUB_API   = "https://api.github.com"

MAX_FILE_SIZE  = 50 * 1024 * 1024
MAX_FILE_COUNT = 10

TEXT_EXTENSIONS = {".log", ".txt", ".csv", ".json"}

# Base directory for saved attachments — relative to wherever uvicorn runs (backend/)
ISSUES_DIR = Path("issues")


def _safe_name(name: str) -> str:
    """Strip unsafe characters for use in filenames and folder names."""
    name = os.path.basename(name)
    return re.sub(r"[^\w\.\-\s]", "_", name).strip() or "unnamed"


def _is_text(content_type: str, ext: str) -> bool:
    return content_type.lower().startswith("text/") or ext in TEXT_EXTENSIONS


def _save_locally(title: str, filename: str, raw: bytes) -> Path:
    """Save file to issues/<title>/<filename> and return the path."""
    folder = ISSUES_DIR / _safe_name(title)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / filename
    dest.write_bytes(raw)
    return dest


@router.post("/issue")
async def create_issue(
    title:       str              = Form(...),
    description: str              = Form(...),
    page:        Optional[str]    = Form(None),
    files:       List[UploadFile] = File(default=[]),
):
    if not GITHUB_TOKEN:
        raise HTTPException(500, "GitHub token not configured.")
    if len(files) > MAX_FILE_COUNT:
        raise HTTPException(400, f"Maximum {MAX_FILE_COUNT} attachments allowed.")

    # Read and validate all files upfront
    processed = []
    for upload in files:
        raw = await upload.read(MAX_FILE_SIZE + 1)
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(413, f"{upload.filename} exceeds 50MB limit.")

        filename     = _safe_name(upload.filename or "attachment")
        content_type = (upload.content_type or "application/octet-stream").lower().split(";")[0].strip()
        ext          = os.path.splitext(filename)[1].lower()

        processed.append(dict(raw=raw, filename=filename, content_type=content_type, ext=ext))

    # Build issue body
    body_lines = [description.strip()]
    if page:
        body_lines += ["", f"**Reported from:** `{page}`"]

    if processed:
        body_lines += ["", "---", "### Attachments"]

    saved_paths = []
    for f in processed:
        raw      = f["raw"]
        filename = f["filename"]
        ctype    = f["content_type"]
        ext      = f["ext"]

        if _is_text(ctype, ext):
            # Embed text files inline
            text = raw.decode("utf-8", errors="replace")
            if len(text) > 10_000:
                text = text[:10_000] + f"\n\n... (truncated, {len(raw)} bytes total)"
            body_lines += ["", f"**{filename}**", "```", text, "```"]
            # Also save a local copy
            path = _save_locally(title, filename, raw)
            saved_paths.append(path)
        else:
            # Save locally and note the path in the issue
            path = _save_locally(title, filename, raw)
            saved_paths.append(path)
            body_lines += ["", f"**{filename}** — saved locally at `{path}`"]

    # Create the GitHub issue
    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization":        f"token {GITHUB_TOKEN}",
            "Accept":               "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        resp = await client.post(
            f"{GITHUB_API}/repos/{GITHUB_REPO}/issues",
            headers=headers,
            json={
                "title":  title,
                "body":   "\n".join(body_lines),
                "labels": ["bug", "user-report"],
            },
            timeout=15,
        )

    if resp.status_code == 201:
        data = resp.json()
        return {
            "url":        data["html_url"],
            "number":     data["number"],
            "saved_files": [str(p) for p in saved_paths],
        }
    raise HTTPException(resp.status_code, f"GitHub API error: {resp.text}")