"""Open WebUI import object generation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

from .parser import Conversation

IdFactory = Callable[[], UUID]


def to_openwebui_chat(
    conversation: Conversation,
    model: str | None = None,
    *,
    id_factory: IdFactory = uuid4,
) -> dict[str, Any]:
    """Build one standard Open WebUI chat import object."""

    clean_model = model.strip() if model and model.strip() else None
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
            if clean_model:
                message["model"] = clean_model
        messages[message_id] = message

    chat: dict[str, Any] = {
        "title": conversation.title,
        "models": [clean_model] if clean_model else [],
        "history": {"currentId": ids[-1], "messages": messages},
    }
    return {
        "chat": chat,
        "meta": {},
        "pinned": False,
        "folder_id": None,
    }
