"""Open WebUI import object generation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

from .parser import Conversation

IdFactory = Callable[[], UUID]


def to_openwebui_chat(
    conversation: Conversation,
    model: str,
    *,
    include_thoughts: bool = False,
    id_factory: IdFactory = uuid4,
) -> dict[str, Any]:
    """Build one standard Open WebUI chat import object."""

    clean_model = model.strip()
    if not clean_model:
        raise ValueError("模型名称不能为空")
    ids = [str(id_factory()) for _ in conversation.messages]
    messages: dict[str, dict[str, Any]] = {}

    for index, parsed in enumerate(conversation.messages):
        message_id = ids[index]
        message: dict[str, Any] = {
            "id": message_id,
            "parentId": ids[index - 1] if index else None,
            "childrenIds": [ids[index + 1]] if index + 1 < len(ids) else [],
            "role": parsed.role,
            "content": parsed.content,
        }
        if parsed.role == "assistant":
            message["done"] = True
            message["model"] = clean_model
            if include_thoughts and parsed.thoughts:
                message["output"] = [
                    {
                        "type": "reasoning",
                        "id": f"{message_id}-reasoning",
                        "summary": [{"type": "summary_text", "text": parsed.thoughts}],
                        "status": "completed",
                    },
                    {
                        "type": "message",
                        "id": f"{message_id}-answer",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": parsed.content}],
                        "status": "completed",
                    },
                ]
        messages[message_id] = message

    chat: dict[str, Any] = {
        "title": conversation.title,
        "models": [clean_model],
        "history": {"currentId": ids[-1], "messages": messages},
    }
    return {
        "chat": chat,
        "meta": {},
        "pinned": False,
        "folder_id": None,
    }
