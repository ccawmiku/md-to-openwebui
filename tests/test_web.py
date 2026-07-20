import base64

from fastapi.testclient import TestClient

from md_to_openwebui.web import app

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
                        "# Second\n#### User:\nQuestion\n---\n#### Assistant:\nAnswer\n---\n"
                    ),
                },
            ],
            "model": "llama3.2",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["chat_count"] == 2
    assert data["message_count"] == 3
    assert [item["chat"]["title"] for item in data["output"]] == ["第一段", "Second"]


def test_rejects_non_markdown_file() -> None:
    response = client.post(
        "/api/convert",
        json={"files": [{"name": "chat.txt", "data_base64": encoded("text")}]},
    )

    assert response.status_code == 422
    assert "只支持 .md" in response.json()["detail"]


def test_rejects_invalid_base64_utf8_and_markdown() -> None:
    invalid_base64 = client.post(
        "/api/convert", json={"files": [{"name": "chat.md", "data_base64": "%%%"}]}
    )
    invalid_utf8 = client.post(
        "/api/convert",
        json={"files": [{"name": "chat.md", "data_base64": base64.b64encode(b"\xff").decode()}]},
    )
    invalid_markdown = client.post(
        "/api/convert",
        json={"files": [{"name": "chat.md", "data_base64": encoded("# title")}]},
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
