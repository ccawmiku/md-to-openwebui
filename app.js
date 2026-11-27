"use strict";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// ---- Parser (ported from src/md_to_openwebui/parser.py) ----

const ROLE_HEADER = /^####[ \t]+(user|assistant):[ \t]*$/im;
const TITLE = /^#[ \t]+(.+?)[ \t]*$/m;
const THOUGHTS_MARKER = /^[ \t]*\*\*Thoughts:\*\*[ \t]*$/im;
const RESPONSE_MARKER = /^[ \t]*\*\*(?:Response|Answer):\*\*[ \t]*$/im;

class MarkdownParseError extends Error {}

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

function stripBoundaryRule(block) {
  const lines = splitLines(block);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && lines[0].trim() === "---") lines.shift();
  if (lines.length && lines[lines.length - 1].trim() === "---") lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

function splitThoughts(block, role) {
  const marker = THOUGHTS_MARKER.exec(block);
  if (!marker) return [stripBoundaryRule(block), null];

  const contentBefore = stripBoundaryRule(block.slice(0, marker.index));
  const contentAfter = block.slice(marker.index + marker[0].length);
  const responseMarker = RESPONSE_MARKER.exec(contentAfter);
  if (role === "assistant" && responseMarker) {
    const thoughts = stripBoundaryRule(contentAfter.slice(0, responseMarker.index));
    const response = stripBoundaryRule(
      contentAfter.slice(responseMarker.index + responseMarker[0].length),
    );
    return [response, thoughts || null];
  }

  const thoughts = stripBoundaryRule(contentAfter);
  return [contentBefore, thoughts || null];
}

function filenameStem(filename) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function parseMarkdown(text, filename) {
  const matches = [];
  const roleRe = /^####[ \t]+(user|assistant):[ \t]*$/gim;
  let match;
  while ((match = roleRe.exec(text)) !== null) matches.push(match);
  if (!matches.length) {
    throw new MarkdownParseError("未找到 `#### User:` 或 `#### Assistant:` 消息标题");
  }

  const preamble = text.slice(0, matches[0].index);
  const titleMatch = TITLE.exec(preamble);
  const fallbackTitle = filenameStem(filename).trim() || "Imported Chat";
  const title = titleMatch ? titleMatch[1].trim() : fallbackTitle;

  const messages = [];
  const pendingThoughts = [];
  for (let index = 0; index < matches.length; index++) {
    const current = matches[index];
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const role = current[1].toLowerCase();
    const [content, rawThoughts] = splitThoughts(
      text.slice(current.index + current[0].length, end),
      role,
    );
    let thoughts = rawThoughts;
    if (role === "user" && thoughts) {
      pendingThoughts.push(thoughts);
      thoughts = null;
    } else if (role === "assistant") {
      const allThoughts = [...pendingThoughts, ...(thoughts ? [thoughts] : [])];
      thoughts = allThoughts.join("\n\n") || null;
      pendingThoughts.length = 0;
    }
    if (!content) {
      const displayRole = current[1].charAt(0).toUpperCase() + current[1].slice(1).toLowerCase();
      throw new MarkdownParseError(`第 ${index + 1} 条 ${displayRole} 消息内容为空`);
    }
    messages.push({ role, content, thoughts });
  }
  if (pendingThoughts.length) {
    throw new MarkdownParseError("Thoughts 部分后没有对应的 Assistant 消息");
  }
  return { title, messages };
}

// ---- Converter (ported from src/md_to_openwebui/converter.py) ----

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function toOpenWebUIChat(conversation, model, includeThoughts) {
  const cleanModel = model.trim();
  if (!cleanModel) throw new Error("模型名称不能为空");
  const ids = conversation.messages.map(() => uuid());
  const messages = {};
  for (let index = 0; index < conversation.messages.length; index++) {
    const parsed = conversation.messages[index];
    const messageId = ids[index];
    const message = {
      id: messageId,
      parentId: index ? ids[index - 1] : null,
      childrenIds: index + 1 < ids.length ? [ids[index + 1]] : [],
      role: parsed.role,
      content: parsed.content,
    };
    if (parsed.role === "assistant") {
      message.done = true;
      message.model = cleanModel;
      if (includeThoughts && parsed.thoughts) {
        message.output = [
          {
            type: "reasoning",
            id: `${messageId}-reasoning`,
            summary: [{ type: "summary_text", text: parsed.thoughts }],
            status: "completed",
          },
          {
            type: "message",
            id: `${messageId}-answer`,
            role: "assistant",
            content: [{ type: "output_text", text: parsed.content }],
            status: "completed",
          },
        ];
      }
    }
    messages[messageId] = message;
  }
  const chat = {
    title: conversation.title,
    models: [cleanModel],
    history: { currentId: ids[ids.length - 1], messages },
  };
  return { chat, meta: {}, pinned: false, folder_id: null };
}

function convertFiles(files, model, includeThoughts) {
  const output = [];
  const summaries = [];
  for (const file of files) {
    let conversation;
    try {
      conversation = parseMarkdown(file.text, file.name);
    } catch (error) {
      throw new Error(`${file.name}: ${error.message}`);
    }
    output.push(toOpenWebUIChat(conversation, model, includeThoughts));
    summaries.push({
      name: file.name,
      title: conversation.title,
      messages: conversation.messages.length,
      thoughts: conversation.messages.filter((message) => message.thoughts != null).length,
    });
  }
  return {
    output,
    files: summaries,
    chat_count: output.length,
    message_count: summaries.reduce((sum, item) => sum + item.messages, 0),
    thought_count: summaries.reduce((sum, item) => sum + item.thoughts, 0),
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- UI ----

function initApp() {
  const form = document.querySelector("#convert-form");
  const fileInput = document.querySelector("#file-input");
  const dropZone = document.querySelector("#drop-zone");
  const filePanel = document.querySelector("#file-panel");
  const fileList = document.querySelector("#file-list");
  const fileCount = document.querySelector("#file-count");
  const clearFiles = document.querySelector("#clear-files");
  const convertButton = document.querySelector("#convert-button");
  const modelInput = document.querySelector("#model-input");
  const includeThoughts = document.querySelector("#include-thoughts");
  const statusBox = document.querySelector("#status");
  const result = document.querySelector("#result");
  const downloadButton = document.querySelector("#download-button");
  const jsonPreview = document.querySelector("#json-preview");
  const chatCount = document.querySelector("#chat-count");
  const messageCount = document.querySelector("#message-count");
  const thoughtCount = document.querySelector("#thought-count");
  const thoughtLabel = document.querySelector("#thought-label");
  const outputSize = document.querySelector("#output-size");

  let selectedFiles = [];
  let outputJson = null;

  function updateConvertButton() {
    convertButton.disabled = selectedFiles.length === 0 || modelInput.value.trim() === "";
  }

  function setStatus(message, kind = "error") {
    statusBox.textContent = message;
    statusBox.classList.toggle("is-working", kind === "working");
    statusBox.hidden = false;
  }

  function clearStatus() {
    statusBox.hidden = true;
    statusBox.textContent = "";
  }

  function renderFiles() {
    fileList.replaceChildren();
    for (const [index, file] of selectedFiles.entries()) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const size = document.createElement("span");
      const remove = document.createElement("button");

      name.className = "file-name";
      name.textContent = file.name;
      name.title = file.name;
      size.className = "file-size";
      size.textContent = formatBytes(file.size);
      remove.className = "remove-file";
      remove.type = "button";
      remove.setAttribute("aria-label", `移除 ${file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        outputJson = null;
        result.hidden = true;
        renderFiles();
      });

      item.append(name, size, remove);
      fileList.append(item);
    }

    const count = selectedFiles.length;
    filePanel.hidden = count === 0;
    fileCount.textContent = `已选择 ${count} 个文件`;
    updateConvertButton();
  }

  function addFiles(fileCollection) {
    clearStatus();
    const incoming = [...fileCollection];
    const invalid = incoming.find((file) => !file.name.toLowerCase().endsWith(".md"));
    if (invalid) {
      setStatus(`${invalid.name} 不是 Markdown 文件，只支持 .md。`);
      return;
    }
    const oversized = incoming.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setStatus(`${oversized.name} 超过 10 MiB。`);
      return;
    }

    const known = new Set(selectedFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!known.has(key)) {
        selectedFiles.push(file);
        known.add(key);
      }
    }

    if (selectedFiles.length > MAX_FILES) {
      selectedFiles = selectedFiles.slice(0, MAX_FILES);
      setStatus(`一次最多选择 ${MAX_FILES} 个文件，多余文件未加入。`);
    }
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      selectedFiles = [];
      setStatus("所选文件总大小超过 50 MiB，请分批转换。 ");
    }
    outputJson = null;
    result.hidden = true;
    renderFiles();
  }

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  }

  dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  clearFiles.addEventListener("click", () => {
    selectedFiles = [];
    outputJson = null;
    result.hidden = true;
    clearStatus();
    renderFiles();
  });

  for (const control of [modelInput, includeThoughts]) {
    control.addEventListener("input", () => {
      outputJson = null;
      result.hidden = true;
      clearStatus();
      updateConvertButton();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedFiles.length) return;
    const model = modelInput.value.trim();
    if (!model) {
      setStatus("请填写模型名称。 ");
      modelInput.focus();
      return;
    }

    convertButton.disabled = true;
    setStatus("正在读取并转换文件…", "working");
    try {
      const files = await Promise.all(
        selectedFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
            return { name: file.name, text };
          } catch {
            throw new Error(`${file.name}: 不是有效的 UTF-8 文件`);
          }
        }),
      );

      const data = convertFiles(files, model, includeThoughts.checked);

      outputJson = JSON.stringify(data.output, null, 2);
      const bytes = new Blob([outputJson]).size;
      chatCount.textContent = data.chat_count;
      messageCount.textContent = data.message_count;
      thoughtCount.textContent = data.thought_count;
      thoughtLabel.textContent = includeThoughts.checked ? "段思考已保留" : "段思考已丢弃";
      outputSize.textContent = formatBytes(bytes);
      jsonPreview.textContent = outputJson.length > 120000
        ? `${outputJson.slice(0, 120000)}\n\n… 预览已截断，下载文件包含完整内容。`
        : outputJson;
      result.hidden = false;
      clearStatus();
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      result.hidden = true;
      setStatus(error instanceof Error ? error.message : "转换失败，请重试。 ");
    } finally {
      updateConvertButton();
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!outputJson) return;
    const blob = new Blob([outputJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    link.href = url;
    link.download = `openwebui-chats-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

if (typeof document !== "undefined") {
  initApp();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MAX_FILES,
    MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
    MarkdownParseError,
    splitLines,
    stripBoundaryRule,
    splitThoughts,
    filenameStem,
    parseMarkdown,
    uuid,
    toOpenWebUIChat,
    convertFiles,
    formatBytes,
    initApp,
  };
}
