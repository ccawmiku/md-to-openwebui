from uuid import UUID

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
            Message("assistant", "two"),
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
    assert third["childrenIds"] == []
    assert history["currentId"] == third["id"]


def test_omits_assistant_model_when_none_is_given() -> None:
    conversation = Conversation(title="No model", messages=(Message("assistant", "hello"),))

    result = to_openwebui_chat(conversation, "   ")
    message = next(iter(result["chat"]["history"]["messages"].values()))

    assert result["chat"]["models"] == []
    assert "model" not in message
