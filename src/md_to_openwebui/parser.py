"""Parser for role-labelled Markdown chat exports."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


class MarkdownParseError(ValueError):
    """Raised when a Markdown file does not contain a supported conversation."""


@dataclass(frozen=True, slots=True)
class Message:
    """A parsed chat message."""

    role: str
    content: str


@dataclass(frozen=True, slots=True)
class Conversation:
    """A parsed linear conversation."""

    title: str
    messages: tuple[Message, ...]


ROLE_HEADER = re.compile(r"(?im)^####[ \t]+(user|assistant):[ \t]*$")
TITLE = re.compile(r"(?m)^#[ \t]+(.+?)[ \t]*$")


def _strip_boundary_rule(block: str) -> str:
    """Remove export delimiters at a message boundary without altering inner rules."""

    lines = block.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[0].strip() == "---":
        lines.pop(0)
    if lines and lines[-1].strip() == "---":
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def parse_markdown(text: str, filename: str) -> Conversation:
    """Parse a Markdown export into a conversation.

    The first H1 before the first role header is used as the title. If no H1 is
    present, the source filename stem is used.
    """

    matches = list(ROLE_HEADER.finditer(text))
    if not matches:
        raise MarkdownParseError("未找到 `#### User:` 或 `#### Assistant:` 消息标题")

    preamble = text[: matches[0].start()]
    title_match = TITLE.search(preamble)
    fallback_title = Path(filename).stem.strip() or "Imported Chat"
    title = title_match.group(1).strip() if title_match else fallback_title

    messages: list[Message] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = _strip_boundary_rule(text[match.end() : end])
        if not content:
            display_role = match.group(1).title()
            raise MarkdownParseError(f"第 {index + 1} 条 {display_role} 消息内容为空")
        messages.append(Message(role=match.group(1).lower(), content=content))

    return Conversation(title=title, messages=tuple(messages))
