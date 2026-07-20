"use strict";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
      selectedFiles.map(async (file) => ({
        name: file.name,
        data_base64: await fileToBase64(file),
      })),
    );
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, model, include_thoughts: includeThoughts.checked }),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "转换失败，请检查文件格式。";
      throw new Error(detail);
    }

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
