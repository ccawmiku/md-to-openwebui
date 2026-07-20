"""FastAPI web application."""

from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.base import RequestResponseEndpoint

from .converter import to_openwebui_chat
from .parser import MarkdownParseError, parse_markdown

MAX_FILES = 50
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = 70 * 1024 * 1024
STATIC_DIR = Path(__file__).with_name("static")


class InputFile(BaseModel):
    """A browser-read file kept in the request body only."""

    name: Annotated[str, Field(min_length=1, max_length=255)]
    data_base64: str


class ConvertRequest(BaseModel):
    """Batch conversion request."""

    files: Annotated[list[InputFile], Field(min_length=1, max_length=MAX_FILES)]
    model: Annotated[str | None, Field(max_length=200)] = None


class FileSummary(BaseModel):
    """Summary of a converted source file."""

    name: str
    title: str
    messages: int


class ConvertResponse(BaseModel):
    """Batch conversion response."""

    output: list[dict[str, Any]]
    files: list[FileSummary]
    chat_count: int
    message_count: int


app = FastAPI(
    title="Markdown to Open WebUI",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def secure_and_limit_requests(
    request: Request, call_next: RequestResponseEndpoint
) -> Response:
    """Reject oversized bodies early and add local-app security headers."""

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            too_large = int(content_length) > MAX_REQUEST_BYTES
        except ValueError:
            too_large = True
        if too_large:
            return JSONResponse(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                content={"detail": "请求体超过 70 MiB 限制"},
            )

    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    """Serve the converter interface."""

    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    """Return service health."""

    return {"status": "ok"}


def _decode_source(source: InputFile) -> bytes:
    if not source.name.lower().endswith(".md"):
        raise HTTPException(status_code=422, detail=f"{source.name}: 只支持 .md 文件")
    try:
        raw = base64.b64decode(source.data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{source.name}: Base64 数据无效") from exc
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"{source.name}: 文件超过 10 MiB")
    return raw


@app.post("/api/convert", response_model=ConvertResponse)
def convert(payload: ConvertRequest) -> ConvertResponse:
    """Convert one or more UTF-8 Markdown exports without persisting them."""

    decoded = [(source, _decode_source(source)) for source in payload.files]
    if sum(len(raw) for _, raw in decoded) > MAX_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="文件总大小超过 50 MiB")

    output: list[dict[str, Any]] = []
    summaries: list[FileSummary] = []
    for source, raw in decoded:
        try:
            text = raw.decode("utf-8-sig", errors="strict")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"{source.name}: 不是有效的 UTF-8 文件",
            ) from exc
        try:
            conversation = parse_markdown(text, source.name)
        except MarkdownParseError as exc:
            raise HTTPException(status_code=422, detail=f"{source.name}: {exc}") from exc

        output.append(to_openwebui_chat(conversation, payload.model))
        summaries.append(
            FileSummary(
                name=source.name,
                title=conversation.title,
                messages=len(conversation.messages),
            )
        )

    return ConvertResponse(
        output=output,
        files=summaries,
        chat_count=len(output),
        message_count=sum(item.messages for item in summaries),
    )


def main() -> None:
    """Run the local web server."""

    import uvicorn

    uvicorn.run("md_to_openwebui.web:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
