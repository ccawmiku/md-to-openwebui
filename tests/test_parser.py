import pytest

from md_to_openwebui.parser import MarkdownParseError, parse_markdown


def test_parses_chinese_conversation_and_preserves_inner_markdown() -> None:
    source = """# 中文标题

#### User:
第一段

---

仍是同一条消息
---

#### Assistant:
回答 **加粗**
---
"""

    conversation = parse_markdown(source, "fallback.md")

    assert conversation.title == "中文标题"
    assert [message.role for message in conversation.messages] == ["user", "assistant"]
    assert conversation.messages[0].content == "第一段\n\n---\n\n仍是同一条消息"
    assert conversation.messages[1].content == "回答 **加粗**"


def test_uses_filename_when_title_is_missing_and_headers_are_case_insensitive() -> None:
    conversation = parse_markdown("#### user:\n你好\n", "没有标题.md")

    assert conversation.title == "没有标题"
    assert conversation.messages[0].content == "你好"


@pytest.mark.parametrize(
    ("source", "message"),
    [
        ("# Empty", "未找到"),
        ("#### User:\n---\n", "内容为空"),
    ],
)
def test_rejects_invalid_exports(source: str, message: str) -> None:
    with pytest.raises(MarkdownParseError, match=message):
        parse_markdown(source, "bad.md")
