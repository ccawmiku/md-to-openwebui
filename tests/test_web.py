import base64
import json
import socket

from fastapi.testclient import TestClient

from md_to_openwebui import web as web_module
from md_to_openwebui.web import _choose_port, app, main

client = TestClient(app)


def encoded(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def test_index_and_health_include_security_headers() -> None:
    page = client.get("/")
    health = client.get("/api/health")

    assert page.status_code == 200
    assert "Markdown → Open WebUI" in page.text
    assert page.headers["x-content-type-options"] == "nosniff"
    assert health.json() == {"status": "ok"}


def test_converts_multiple_files() -> None:
    response = client.post(
        "/api/convert",
        json={
            "files": [
                {
                    "name": "一.md",
                    "data_base64": encoded("# 第一段\n#### User:\n你好\n---\n"),
                },
                {
                    "name": "two.md",
                    "data_base64": encoded(
                        "# Second\n#### User:\nQuestion\n---\n**Thoughts:**\nReasoning\n---\n"
                        "#### Assistant:\nAnswer\n---\n"
                    ),
                },
            ],
            "model": "llama3.2",
            "include_thoughts": False,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["chat_count"] == 2
    assert data["message_count"] == 3
    assert data["thought_count"] == 1
    assert [item["chat"]["title"] for item in data["output"]] == ["第一段", "Second"]
    second_messages = list(data["output"][1]["chat"]["history"]["messages"].values())
    assert second_messages[0]["content"] == "Question"
    assert second_messages[1]["content"] == "Answer"
    assert "output" not in second_messages[1]
    assert "Reasoning" not in json.dumps(data["output"])


def test_preserves_thoughts_when_requested() -> None:
    response = client.post(
        "/api/convert",
        json={
            "files": [
                {
                    "name": "thoughts.md",
                    "data_base64": encoded(
                        "#### User:\nQuestion\n**Thoughts:**\nReasoning\n"
                        "#### Assistant:\nAnswer\n"
                    ),
                }
            ],
            "model": "required-model",
            "include_thoughts": True,
        },
    )

    assert response.status_code == 200
    data = response.json()
    messages = list(data["output"][0]["chat"]["history"]["messages"].values())
    assert data["output"][0]["chat"]["models"] == ["required-model"]
    assert messages[1]["model"] == "required-model"
    assert messages[1]["output"][0]["summary"][0]["text"] == "Reasoning"


def test_requires_non_blank_model() -> None:
    file = {"name": "chat.md", "data_base64": encoded("#### User:\nHello\n")}

    missing = client.post("/api/convert", json={"files": [file]})
    blank = client.post("/api/convert", json={"files": [file], "model": "   "})

    assert missing.status_code == 422
    assert blank.status_code == 422
    assert blank.json()["detail"] == "模型名称不能为空"


def test_rejects_non_markdown_file() -> None:
    response = client.post(
        "/api/convert",
        json={
            "files": [{"name": "chat.txt", "data_base64": encoded("text")}],
            "model": "test-model",
        },
    )

    assert response.status_code == 422
    assert "只支持 .md" in response.json()["detail"]


def test_rejects_invalid_base64_utf8_and_markdown() -> None:
    invalid_base64 = client.post(
        "/api/convert",
        json={
            "files": [{"name": "chat.md", "data_base64": "%%%"}],
            "model": "test-model",
        },
    )
    invalid_utf8 = client.post(
        "/api/convert",
        json={
            "files": [
                {"name": "chat.md", "data_base64": base64.b64encode(b"\xff").decode()}
            ],
            "model": "test-model",
        },
    )
    invalid_markdown = client.post(
        "/api/convert",
        json={
            "files": [{"name": "chat.md", "data_base64": encoded("# title")}],
            "model": "test-model",
        },
    )

    assert invalid_base64.status_code == 422
    assert invalid_utf8.status_code == 422
    assert invalid_markdown.status_code == 422


def test_rejects_invalid_or_oversized_content_length() -> None:
    invalid = client.post(
        "/api/convert",
        content=b"{}",
        headers={"content-type": "application/json", "content-length": "invalid"},
    )
    oversized = client.post(
        "/api/convert",
        content=b"{}",
        headers={"content-type": "application/json", "content-length": str(71 * 1024 * 1024)},
    )

    assert invalid.status_code == 413
    assert oversized.status_code == 413


def test_choose_port_uses_free_port_and_falls_back_when_preferred_is_busy() -> None:
    assert _choose_port(0) > 0

    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        occupied_port = int(occupied.getsockname()[1])
        assert _choose_port(occupied_port) != occupied_port


def test_main_can_start_without_opening_browser(monkeypatch) -> None:
    calls = {}

    def fake_run(app_arg, *, host: str, port: int) -> None:
        calls.update(app=app_arg, host=host, port=port)

    monkeypatch.setenv("MD_TO_OPENWEBUI_NO_BROWSER", "1")
    monkeypatch.setattr(web_module, "_choose_port", lambda: 8123)
    monkeypatch.setattr("uvicorn.run", fake_run)

    main()

    assert calls == {"app": app, "host": "127.0.0.1", "port": 8123}


def test_main_opens_browser_for_interactive_start(monkeypatch) -> None:
    calls = {}

    class FakeTimer:
        daemon = False

        def __init__(self, interval, function, args) -> None:
            calls.update(interval=interval, function=function, args=args)

        def start(self) -> None:
            calls["started"] = True

    monkeypatch.delenv("MD_TO_OPENWEBUI_NO_BROWSER", raising=False)
    monkeypatch.setattr(web_module, "_choose_port", lambda: 8124)
    monkeypatch.setattr(web_module.threading, "Timer", FakeTimer)
    monkeypatch.setattr("uvicorn.run", lambda *args, **kwargs: None)

    main()

    assert calls["interval"] == 0.8
    assert calls["function"] is web_module.webbrowser.open
    assert calls["args"] == ("http://127.0.0.1:8124",)
    assert calls["started"] is True
