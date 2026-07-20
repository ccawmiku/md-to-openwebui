import json
from uuid import UUID

import pytest

from md_to_openwebui.converter import to_openwebui_chat
from md_to_openwebui.parser import Conversation, Message


def test_builds_openwebui_standard_message_tree() -> None:
    values = iter(
        [
            UUID("00000000-0000-0000-0000-000000000001"),
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("00000000-0000-0000-0000-000000000003"),
        ]
    )
    conversation = Conversation(
        title="Tree",
        messages=(
            Message("user", "one"),
            Message("assistant", "two", "reasoning"),
            Message("user", "three"),
        ),
    )

    result = to_openwebui_chat(conversation, " model-id ", id_factory=lambda: next(values))
    history = result["chat"]["history"]
    messages = history["messages"]
    first = messages["00000000-0000-0000-0000-000000000001"]
    second = messages["00000000-0000-0000-0000-000000000002"]
    third = messages["00000000-0000-0000-0000-000000000003"]

    assert result["chat"]["models"] == ["model-id"]
    assert first["parentId"] is None
    assert first["childrenIds"] == [second["id"]]
    assert second["parentId"] == first["id"]
    assert second["childrenIds"] == [third["id"]]
    assert second["model"] == "model-id"
    assert second["done"] is True
    assert second["content"] == "two"
    assert "output" not in second
    assert "reasoning" not in json.dumps(result)
    assert third["childrenIds"] == []
    assert history["currentId"] == third["id"]


def test_rejects_blank_model() -> None:
    conversation = Conversation(title="No model", messages=(Message("assistant", "hello"),))

    with pytest.raises(ValueError, match="模型名称不能为空"):
        to_openwebui_chat(conversation, "   ")


def test_includes_thoughts_only_when_requested() -> None:
    conversation = Conversation(
        title="Thoughts",
        messages=(Message("assistant", "answer", "private reasoning"),),
    )

    result = to_openwebui_chat(conversation, "model-id", include_thoughts=True)
    message = next(iter(result["chat"]["history"]["messages"].values()))

    assert message["model"] == "model-id"
    assert message["output"][0]["type"] == "reasoning"
    assert message["output"][0]["summary"] == [
        {"type": "summary_text", "text": "private reasoning"}
    ]
    assert message["output"][1]["content"] == [
        {"type": "output_text", "text": "answer"}
    ]
