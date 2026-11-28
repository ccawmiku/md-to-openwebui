"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

async function dropVirtualFiles(page, fileSpecs) {
  await page.evaluate((specs) => {
    const dataTransfer = new DataTransfer();
    for (const spec of specs) {
      const content = spec.bytes
        ? new Uint8Array(spec.bytes)
        : new TextEncoder().encode(spec.text ?? "");
      const blobParts = spec.paddingBytes
        ? [content, new Uint8Array(spec.paddingBytes)]
        : [content];
      const file = new File(blobParts, spec.name, {
        type: spec.type || "text/markdown",
        lastModified: spec.lastModified ?? 1700000000000,
      });
      dataTransfer.items.add(file);
    }

    const dropZone = document.querySelector("#drop-zone");
    dropZone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, fileSpecs);
}

test.describe("Markdown → Open WebUI 前端端到端测试", () => {
  test("初始渲染、file:// 本地打开兼容且无控制台异常", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await expect(page).toHaveTitle("Markdown → Open WebUI");
    await expect(page.locator("#convert-button")).toBeDisabled();
    await expect(page.locator("#file-panel")).toBeHidden();
    await expect(page.locator("#result")).toBeHidden();
    await expect(page.locator("#status")).toBeHidden();

    // 验证直接在本地以 file:// 协议打开 index.html 同样零构建正常运行
    const fileUrl = pathToFileURL(path.resolve(__dirname, "../../index.html")).href;
    await page.goto(fileUrl);
    await expect(page.locator("#convert-button")).toBeDisabled();
    await page.locator("#file-input").setInputFiles({
      name: "local-open.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 本地直开\n\n#### User:\n你好\n#### Assistant:\n世界\n", "utf8"),
    });
    await page.locator("#model-input").fill("llama3.2");
    await expect(page.locator("#convert-button")).toBeEnabled();
    await page.locator("#convert-button").click();
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#chat-count")).toHaveText("1");
    await expect(page.locator("#message-count")).toHaveText("2");

    expect(errors).toEqual([]);
  });

  test("文件上传、去重、拖拽、单项移除、全部清除与按钮禁用联动", async ({ page }) => {
    await page.goto("/");

    const sampleBuffer = Buffer.from("#### User:\n问题1\n#### Assistant:\n回答1\n", "utf8");
    await page.locator("#file-input").setInputFiles([
      { name: "alpha.md", mimeType: "text/markdown", buffer: sampleBuffer },
      { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from("#### User:\nQ\n#### Assistant:\nA\n", "utf8") },
    ]);

    await expect(page.locator("#file-panel")).toBeVisible();
    await expect(page.locator("#file-count")).toHaveText("已选择 2 个文件");
    await expect(page.locator("#file-list li")).toHaveCount(2);
    await expect(page.locator("#convert-button")).toBeDisabled();

    // 使用相同 name + size + lastModified 触发去重逻辑，并验证大写 .MD 扩展名与拖拽态样式
    await page.evaluate(() => {
      const dropZone = document.querySelector("#drop-zone");
      dropZone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true }));
    });
    await expect(page.locator("#drop-zone")).toHaveClass(/is-dragging/);
    await page.evaluate(() => {
      const dropZone = document.querySelector("#drop-zone");
      dropZone.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true }));
    });
    await expect(page.locator("#drop-zone")).not.toHaveClass(/is-dragging/);

    await dropVirtualFiles(page, [
      { name: "GAMMA.MD", text: "#### User:\n新问题\n#### Assistant:\n新回答\n", lastModified: 1700000001111 },
      { name: "GAMMA.MD", text: "#### User:\n新问题\n#### Assistant:\n新回答\n", lastModified: 1700000001111 },
    ]);
    await expect(page.locator("#drop-zone")).not.toHaveClass(/is-dragging/);
    await expect(page.locator("#file-count")).toHaveText("已选择 3 个文件");

    // 填写模型名后启用，清空模型名后重新禁用
    await page.locator("#model-input").fill("  ");
    await expect(page.locator("#convert-button")).toBeDisabled();
    await page.locator("#model-input").fill("qwen3");
    await expect(page.locator("#convert-button")).toBeEnabled();

    // 转换后修改模型名或移除单个文件会隐藏旧结果
    await page.locator("#convert-button").click();
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#chat-count")).toHaveText("3");
    await expect(page.locator("#message-count")).toHaveText("6");
    await expect(page.locator("#output-size")).not.toHaveText("0 KB");

    await page.locator("#model-input").fill("qwen3-max");
    await expect(page.locator("#result")).toBeHidden();
    await page.locator("#convert-button").click();
    await expect(page.locator("#result")).toBeVisible();

    // 移除单个文件并验证结果隐藏
    await page.getByRole("button", { name: "移除 beta.md" }).click();
    await expect(page.locator("#result")).toBeHidden();
    await expect(page.locator("#file-count")).toHaveText("已选择 2 个文件");
    await expect(page.locator("#file-list")).not.toContainText("beta.md");

    // 全部清除
    await page.locator("#clear-files").click();
    await expect(page.locator("#file-panel")).toBeHidden();
    await expect(page.locator("#file-list li")).toHaveCount(0);
    await expect(page.locator("#convert-button")).toBeDisabled();
  });

  test("文件校验边界：非 .md、超 10 MiB、超 50 个文件、总大小超 50 MiB 与非法 UTF-8", async ({ page }) => {
    await page.goto("/");

    // 1. 非 .md 文件拒绝
    await page.locator("#file-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("#### User:\nhi\n#### Assistant:\nhello", "utf8"),
    });
    await expect(page.locator("#status")).toBeVisible();
    await expect(page.locator("#status")).toHaveText("notes.txt 不是 Markdown 文件，只支持 .md。");
    await expect(page.locator("#file-panel")).toBeHidden();

    // 2. 单文件超过 10 MiB 提示
    await dropVirtualFiles(page, [
      { name: "huge.md", paddingBytes: 10 * 1024 * 1024 + 1 },
    ]);
    await expect(page.locator("#status")).toHaveText("huge.md 超过 10 MiB。");
    await expect(page.locator("#file-panel")).toBeHidden();

    // 3. 超过 50 个文件截断并提示
    const manyFiles = Array.from({ length: 52 }, (_, i) => ({
      name: `chat-${String(i + 1).padStart(2, "0")}.md`,
      text: "#### User:\n你好\n#### Assistant:\n你好",
      lastModified: 1700000000000 + i,
    }));
    await dropVirtualFiles(page, manyFiles);
    await expect(page.locator("#status")).toHaveText("一次最多选择 50 个文件，多余文件未加入。");
    await expect(page.locator("#file-count")).toHaveText("已选择 50 个文件");
    await expect(page.locator("#file-list li")).toHaveCount(50);

    // 4. 总大小超过 50 MiB 清空已选并提示（6 个 9 MiB 文件 = 54 MiB，单个均未超过 10 MiB）
    await page.locator("#clear-files").click();
    const nineMiBFiles = Array.from({ length: 6 }, (_, i) => ({
      name: `batch-${i + 1}.md`,
      paddingBytes: 9 * 1024 * 1024,
      lastModified: 1700000010000 + i,
    }));
    await dropVirtualFiles(page, nineMiBFiles);
    await expect(page.locator("#status")).toContainText("所选文件总大小超过 50 MiB，请分批转换。");
    await expect(page.locator("#file-panel")).toBeHidden();

    // 5. 非法 UTF-8 字节流解码报错
    await dropVirtualFiles(page, [
      { name: "bad-utf8.md", bytes: [0xff, 0xfe, 0x80, 0x81] },
    ]);
    await page.locator("#model-input").fill("llama3");
    await page.locator("#convert-button").click();
    await expect(page.locator("#status")).toHaveText("bad-utf8.md: 不是有效的 UTF-8 文件");
    await expect(page.locator("#result")).toBeHidden();

    // 6. 解析错误提示（缺角色标题）
    await page.locator("#clear-files").click();
    await page.locator("#file-input").setInputFiles({
      name: "invalid-md.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 只有标题没有对话", "utf8"),
    });
    await page.locator("#convert-button").click();
    await expect(page.locator("#status")).toContainText("invalid-md.md: 未找到");
  });

  test("完整转换、思考开关文案切换、JSON 下载内容校验", async ({ page }) => {
    await page.goto("/");

    const mdContent = [
      "# 中文对话导出测试",
      "",
      "#### User:",
      "请解释事件循环",
      "---",
      "**Thoughts:**",
      "先梳理宏任务和微任务顺序",
      "---",
      "#### Assistant:",
      "事件循环先执行微任务队列再进入下一轮宏任务。",
      "---",
    ].join("\n");

    await page.locator("#file-input").setInputFiles({
      name: "event-loop.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(mdContent, "utf8"),
    });
    await page.locator("#model-input").fill("deepseek-r1");

    // 第一次：关闭“保留思考过程”
    await expect(page.locator("#include-thoughts")).not.toBeChecked();
    await page.locator("#convert-button").click();

    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#chat-count")).toHaveText("1");
    await expect(page.locator("#message-count")).toHaveText("2");
    await expect(page.locator("#thought-count")).toHaveText("1");
    await expect(page.locator("#thought-label")).toHaveText("段思考已丢弃");

    await page.locator("details.preview summary").click();
    const previewWithout = JSON.parse(await page.locator("#json-preview").textContent());
    expect(previewWithout).toHaveLength(1);
    expect(previewWithout[0].chat.title).toBe("中文对话导出测试");
    expect(previewWithout[0].chat.models).toEqual(["deepseek-r1"]);
    const msgsWithout = Object.values(previewWithout[0].chat.history.messages);
    expect(msgsWithout[1].output).toBeUndefined();

    // 勾选“保留思考过程”后旧结果自动隐藏，再转换应保留 reasoning output
    await page.locator("#include-thoughts").check();
    await expect(page.locator("#result")).toBeHidden();
    await page.locator("#convert-button").click();

    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#thought-label")).toHaveText("段思考已保留");

    const previewWith = JSON.parse(await page.locator("#json-preview").textContent());
    const msgsWith = Object.values(previewWith[0].chat.history.messages);
    expect(msgsWith[1].output).toHaveLength(2);
    expect(msgsWith[1].output[0].type).toBe("reasoning");
    expect(msgsWith[1].output[0].summary[0].text).toBe("先梳理宏任务和微任务顺序");
    expect(msgsWith[1].output[1].type).toBe("message");
    expect(msgsWith[1].output[1].content[0].text).toBe("事件循环先执行微任务队列再进入下一轮宏任务。");

    // 触发下载并校验文件名与真实下载文件内容一致
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#download-button").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^openwebui-chats-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/,
    );
    const downloadedPath = await download.path();
    const downloadedJson = JSON.parse(fs.readFileSync(downloadedPath, "utf8"));
    expect(downloadedJson).toEqual(previewWith);
  });

  test("超过 120000 字符时截断预览文本但下载保留完整 JSON", async ({ page }) => {
    await page.goto("/");

    const longBody = "甲".repeat(130000);
    const mdContent = `# 超长预览测试\n\n#### User:\n请输出长文本\n#### Assistant:\n${longBody}\n`;
    await page.locator("#file-input").setInputFiles({
      name: "long-chat.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(mdContent, "utf8"),
    });
    await page.locator("#model-input").fill("gpt-4o");
    await page.locator("#convert-button").click();

    await expect(page.locator("#result")).toBeVisible();
    await page.locator("details.preview summary").click();

    const previewText = await page.locator("#json-preview").textContent();
    expect(previewText).toContain("… 预览已截断，下载文件包含完整内容。");
    expect(previewText.length).toBeLessThan(120200);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#download-button").click(),
    ]);
    const downloadedPath = await download.path();
    const rawDownloaded = fs.readFileSync(downloadedPath, "utf8");
    expect(rawDownloaded.length).toBeGreaterThan(120000);
    const parsed = JSON.parse(rawDownloaded);
    const msgs = Object.values(parsed[0].chat.history.messages);
    expect(msgs[1].content).toBe(longBody);
  });
});
