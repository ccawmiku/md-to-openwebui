"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("../../app.js");

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("常量与基础工具函数", () => {
  it("暴露正确的限制常量", () => {
    assert.equal(MAX_FILES, 50);
    assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
    assert.equal(MAX_TOTAL_BYTES, 50 * 1024 * 1024);
  });

  it("splitLines 兼容 LF、CRLF 与 CR 换行", () => {
    assert.deepEqual(splitLines("a\nb\r\nc\rd"), ["a", "b", "c", "d"]);
    assert.deepEqual(splitLines(""), [""]);
  });

  it("stripBoundaryRule 剥离首尾空行和边界 --- 但保留正文内分隔线", () => {
    const input = "\n\n  ---  \n第一段\n\n---\n\n第二段\n---\n  \n";
    assert.equal(stripBoundaryRule(input), "第一段\n\n---\n\n第二段");
    assert.equal(stripBoundaryRule("   \n---\n   "), "");
    assert.equal(stripBoundaryRule(""), "");
  });

  it("filenameStem 正确处理扩展名、多点、无扩展名与前导点边界", () => {
    assert.equal(filenameStem("chat.md"), "chat");
    assert.equal(filenameStem("my.chat.backup.md"), "my.chat.backup");
    assert.equal(filenameStem("README"), "README");
    assert.equal(filenameStem(".md"), ".md");
    assert.equal(filenameStem("archive."), "archive");
    assert.equal(filenameStem(""), "");
  });

  it("formatBytes 正确格式化 B、KB 与 MB", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1023), "1023 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(1024 * 1024), "1.0 MB");
    assert.equal(formatBytes(2.5 * 1024 * 1024), "2.5 MB");
  });

  it("uuid 生成标准 UUID v4 且互不重复", () => {
    const first = uuid();
    const second = uuid();
    assert.match(first, UUID_V4_RE);
    assert.match(second, UUID_V4_RE);
    assert.notEqual(first, second);
  });
});

describe("splitThoughts 思考与正文拆分", () => {
  it("无 Thoughts 标记时仅剥离边界分隔线", () => {
    const [content, thoughts] = splitThoughts("\n---\n正文内容\n---\n", "user");
    assert.equal(content, "正文内容");
    assert.equal(thoughts, null);
  });

  it("User 块中提取后置 **Thoughts:** 内容", () => {
    const block = "\n请总结\n---\n**Thoughts:**\n先分析需求\n---\n";
    const [content, thoughts] = splitThoughts(block, "user");
    assert.equal(content, "请总结");
    assert.equal(thoughts, "先分析需求");
  });

  it("Assistant 块支持 **Thoughts:** 与 **Response:** 或 **Answer:** 拆分", () => {
    const withResponse = "\n**thoughts:**\n推理 A\n---\n**Response:**\n回答 A\n---\n";
    assert.deepEqual(splitThoughts(withResponse, "assistant"), ["回答 A", "推理 A"]);

    const withAnswer = "\n**Thoughts:**\n推理 B\n**answer:**\n回答 B\n";
    assert.deepEqual(splitThoughts(withAnswer, "assistant"), ["回答 B", "推理 B"]);
  });

  it("User 块出现 **Response:** 不会触发 Assistant 专用分支", () => {
    const block = "\n提示词\n**Thoughts:**\n思考\n**Response:**\n忽略标记\n";
    const [content, thoughts] = splitThoughts(block, "user");
    assert.equal(content, "提示词");
    assert.equal(thoughts, "思考\n**Response:**\n忽略标记");
  });

  it("空的 **Thoughts:** 段返回 null", () => {
    const [content, thoughts] = splitThoughts("\n正文\n**Thoughts:**\n   \n---\n", "user");
    assert.equal(content, "正文");
    assert.equal(thoughts, null);
  });

  it("Assistant 块无 Response/Answer 标记时回退为 contentBefore 与后置 Thoughts", () => {
    assert.deepEqual(
      splitThoughts("\n前置回答\n**Thoughts:**\n附带思考\n", "assistant"),
      ["前置回答", "附带思考"],
    );
    assert.deepEqual(
      splitThoughts("\n**Thoughts:**\n仅有思考无回答标记\n", "assistant"),
      ["", "仅有思考无回答标记"],
    );
  });
});

describe("parseMarkdown 解析逻辑与边界", () => {
  it("解析单轮及多轮对话并保留中文与代码块", () => {
    const md = [
      "#  测试对话标题  ",
      "",
      "#### User:",
      "你好，帮我看下代码：",
      "```js",
      "console.log(1);",
      "```",
      "---",
      "",
      "#### Assistant:",
      "这是输出结果。",
      "---",
      "",
      "#### User:",
      "谢谢！",
      "",
      "#### Assistant:",
      "不客气！",
    ].join("\n");

    const parsed = parseMarkdown(md, "fallback.md");
    assert.equal(parsed.title, "测试对话标题");
    assert.equal(parsed.messages.length, 4);
    assert.deepEqual(parsed.messages[0], {
      role: "user",
      content: "你好，帮我看下代码：\n```js\nconsole.log(1);\n```",
      thoughts: null,
    });
    assert.deepEqual(parsed.messages[1], {
      role: "assistant",
      content: "这是输出结果。",
      thoughts: null,
    });
    assert.equal(parsed.messages[2].content, "谢谢！");
    assert.equal(parsed.messages[3].content, "不客气！");
  });

  it("支持角色标题大小写混合及制表符分隔", () => {
    const md = "####\tuser:   \n问题\n\n#### ASSISTANT:\t\n回答\n";
    const parsed = parseMarkdown(md, "case-test.md");
    assert.equal(parsed.title, "case-test");
    assert.deepEqual(parsed.messages, [
      { role: "user", content: "问题", thoughts: null },
      { role: "assistant", content: "回答", thoughts: null },
    ]);
  });

  it("无前置一级标题时使用文件名回退且忽略消息体内的 # 标题", () => {
    const md = "#### User:\n# 这不是对话标题\n正文\n#### Assistant:\n收到\n";
    assert.equal(parseMarkdown(md, "notes.v1.md").title, "notes.v1");
    assert.equal(parseMarkdown(md, "plainfile").title, "plainfile");
    assert.equal(parseMarkdown(md, ".md").title, ".md");
    assert.equal(parseMarkdown(md, "   ").title, "Imported Chat");
  });

  it("前置多个 # 标题取第一个，且无空格 #标题 与缩进角色标题不会被误识别", () => {
    const md = [
      "#无空格不作为标题",
      "# 第一个正式标题",
      "# 第二个标题应被忽略",
      "",
      "#### User:",
      "  #### Assistant: 缩进标题应保留在正文内",
      "#### Assistant:",
      "确认收到",
    ].join("\n");

    const parsed = parseMarkdown(md, "multi-h1.md");
    assert.equal(parsed.title, "第一个正式标题");
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[0].content, "  #### Assistant: 缩进标题应保留在正文内");
    assert.equal(parsed.messages[1].content, "确认收到");

    const noSpaceHeader = "#无空格\n#### Assistant:\n开场助手消息\n";
    assert.equal(parseMarkdown(noSpaceHeader, "assistant-first.md").title, "assistant-first");
    assert.deepEqual(parseMarkdown(noSpaceHeader, "assistant-first.md").messages, [
      { role: "assistant", content: "开场助手消息", thoughts: null },
    ]);
  });

  it("兼容 CRLF 与 CR 换行且输出一致", () => {
    const lf = "# 标题\n\n#### User:\n你好\n---\n#### Assistant:\n再见\n---\n";
    const crlf = lf.replaceAll("\n", "\r\n");
    const cr = lf.replaceAll("\n", "\r");

    assert.deepEqual(parseMarkdown(crlf, "a.md"), parseMarkdown(lf, "a.md"));
    assert.deepEqual(parseMarkdown(cr, "a.md"), parseMarkdown(lf, "a.md"));
  });

  it("将 User 块后置 Thoughts 挂载到紧随其后的 Assistant 块并支持多段合并", () => {
    const md = [
      "#### User:",
      "第一问",
      "---",
      "**Thoughts:**",
      "用户段思考 1",
      "---",
      "#### User:",
      "第二问",
      "---",
      "**Thoughts:**",
      "用户段思考 2",
      "---",
      "#### Assistant:",
      "**Thoughts:**",
      "助手自带思考",
      "**Response:**",
      "最终回答",
      "---",
    ].join("\n");

    const parsed = parseMarkdown(md, "thoughts.md");
    assert.equal(parsed.messages.length, 3);
    assert.equal(parsed.messages[0].thoughts, null);
    assert.equal(parsed.messages[1].thoughts, null);
    assert.equal(
      parsed.messages[2].thoughts,
      "用户段思考 1\n\n用户段思考 2\n\n助手自带思考",
    );
    assert.equal(parsed.messages[2].content, "最终回答");
  });
});

describe("parseMarkdown 负向与异常场景", () => {
  it("缺少角色标题时抛出 MarkdownParseError", () => {
    assert.throws(
      () => parseMarkdown("# 只有标题\n没有角色", "empty.md"),
      (err) => {
        assert.ok(err instanceof MarkdownParseError);
        assert.match(err.message, /未找到 `#### User:` 或 `#### Assistant:` 消息标题/);
        return true;
      },
    );
    assert.throws(() => parseMarkdown("", "blank.md"), MarkdownParseError);
  });

  it("第 N 条消息内容为空时抛出包含序号和角色的错误", () => {
    assert.throws(
      () => parseMarkdown("#### user:\n---\n", "u.md"),
      (err) => {
        assert.ok(err instanceof MarkdownParseError);
        assert.equal(err.message, "第 1 条 User 消息内容为空");
        return true;
      },
    );

    assert.throws(
      () => parseMarkdown("#### User:\n问题\n#### assistant:\n   \n---\n", "a.md"),
      (err) => {
        assert.ok(err instanceof MarkdownParseError);
        assert.equal(err.message, "第 2 条 Assistant 消息内容为空");
        return true;
      },
    );
  });

  it("仅有 **Thoughts:** 而正文为空时抛出内容为空错误", () => {
    assert.throws(
      () => parseMarkdown("#### User:\n**Thoughts:**\n孤立思考\n#### Assistant:\n回答", "only-thoughts.md"),
      (err) => err instanceof MarkdownParseError && err.message === "第 1 条 User 消息内容为空",
    );
  });

  it("末尾存在未配对的 Thoughts 时抛出悬空 Thoughts 错误", () => {
    const md = "#### User:\n问题\n**Thoughts:**\n悬空思考\n";
    assert.throws(
      () => parseMarkdown(md, "dangling.md"),
      (err) => {
        assert.ok(err instanceof MarkdownParseError);
        assert.equal(err.message, "Thoughts 部分后没有对应的 Assistant 消息");
        return true;
      },
    );
  });
});

describe("toOpenWebUIChat 与 convertFiles", () => {
  it("生成标准 Open WebUI 对话结构与链式消息树", () => {
    const conv = parseMarkdown(
      "# 链式测试\n\n#### User:\nU1\n#### Assistant:\nA1\n#### User:\nU2\n#### Assistant:\nA2\n",
      "chain.md",
    );
    const result = toOpenWebUIChat(conv, "  llama3.2  ", false);

    assert.equal(result.pinned, false);
    assert.equal(result.folder_id, null);
    assert.deepEqual(result.meta, {});

    const { chat } = result;
    assert.equal(chat.title, "链式测试");
    assert.deepEqual(chat.models, ["llama3.2"]);

    const entries = Object.values(chat.history.messages);
    assert.equal(entries.length, 4);
    assert.equal(chat.history.currentId, entries[3].id);

    assert.equal(entries[0].parentId, null);
    assert.deepEqual(entries[0].childrenIds, [entries[1].id]);
    assert.equal(entries[0].role, "user");
    assert.equal("done" in entries[0], false);
    assert.equal("model" in entries[0], false);

    assert.equal(entries[1].parentId, entries[0].id);
    assert.deepEqual(entries[1].childrenIds, [entries[2].id]);
    assert.equal(entries[1].role, "assistant");
    assert.equal(entries[1].done, true);
    assert.equal(entries[1].model, "llama3.2");

    assert.equal(entries[2].parentId, entries[1].id);
    assert.deepEqual(entries[2].childrenIds, [entries[3].id]);

    assert.equal(entries[3].parentId, entries[2].id);
    assert.deepEqual(entries[3].childrenIds, []);
  });

  it("includeThoughts 开关正确控制 output 字段与 reasoning 结构", () => {
    const conv = parseMarkdown(
      "#### User:\n问题\n**Thoughts:**\n思考细节\n#### Assistant:\n最终答案\n",
      "t.md",
    );

    const withoutThoughts = toOpenWebUIChat(conv, "gpt-oss", false);
    const msgsWithout = Object.values(withoutThoughts.chat.history.messages);
    assert.equal("output" in msgsWithout[1], false);

    const withThoughts = toOpenWebUIChat(conv, "gpt-oss", true);
    const msgsWith = Object.values(withThoughts.chat.history.messages);
    const assistant = msgsWith[1];
    assert.deepEqual(assistant.output, [
      {
        type: "reasoning",
        id: `${assistant.id}-reasoning`,
        summary: [{ type: "summary_text", text: "思考细节" }],
        status: "completed",
      },
      {
        type: "message",
        id: `${assistant.id}-answer`,
        role: "assistant",
        content: [{ type: "output_text", text: "最终答案" }],
        status: "completed",
      },
    ]);
  });

  it("模型名称为空白时抛出错误", () => {
    const conv = parseMarkdown("#### User:\nhi\n#### Assistant:\nhello", "m.md");
    assert.throws(() => toOpenWebUIChat(conv, "", false), /模型名称不能为空/);
    assert.throws(() => toOpenWebUIChat(conv, "   \t ", true), /模型名称不能为空/);
    assert.throws(
      () => convertFiles([{ name: "m.md", text: "#### User:\nhi\n#### Assistant:\nhello" }], "  ", true),
      /模型名称不能为空/,
    );
  });

  it("includeThoughts=true 时仅对存在思考内容的助手消息生成 output，单条消息树边界正确", () => {
    const conv = parseMarkdown(
      [
        "#### User:",
        "第一问",
        "#### Assistant:",
        "无思考回答",
        "#### User:",
        "第二问",
        "**Thoughts:**",
        "有思考",
        "#### Assistant:",
        "带思考回答",
      ].join("\n"),
      "mixed-thoughts.md",
    );
    const res = toOpenWebUIChat(conv, "gpt-4o", true);
    const msgs = Object.values(res.chat.history.messages);
    assert.equal("output" in msgs[1], false);
    assert.ok(Array.isArray(msgs[3].output));
    assert.equal(msgs[3].output[0].summary[0].text, "有思考");

    const singleConv = parseMarkdown("#### Assistant:\n仅一条助手消息", "single.md");
    const singleRes = toOpenWebUIChat(singleConv, "gpt-4o", false);
    const singleMsgs = Object.values(singleRes.chat.history.messages);
    assert.equal(singleMsgs.length, 1);
    assert.equal(singleMsgs[0].parentId, null);
    assert.deepEqual(singleMsgs[0].childrenIds, []);
    assert.equal(singleRes.chat.history.currentId, singleMsgs[0].id);
  });

  it("convertFiles 正确汇总多文件统计与 thought_count（含 includeThoughts=false）", () => {
    const files = [
      {
        name: "first.md",
        text: "# 对话一\n\n#### User:\nQ1\n**Thoughts:**\nT1\n#### Assistant:\nA1\n",
      },
      {
        name: "second.md",
        text: "#### User:\nQ2\n#### Assistant:\nA2\n#### User:\nQ3\n#### Assistant:\nA3\n",
      },
    ];

    const res = convertFiles(files, "qwen2.5", false);
    assert.equal(res.chat_count, 2);
    assert.equal(res.message_count, 6);
    assert.equal(res.thought_count, 1);
    assert.deepEqual(res.files, [
      { name: "first.md", title: "对话一", messages: 2, thoughts: 1 },
      { name: "second.md", title: "second", messages: 4, thoughts: 0 },
    ]);
    assert.equal(res.output.length, 2);
    const firstMsgs = Object.values(res.output[0].chat.history.messages);
    assert.equal("output" in firstMsgs[1], false);
  });

  it("convertFiles 传入空数组返回零统计", () => {
    assert.deepEqual(convertFiles([], "model-x", true), {
      output: [],
      files: [],
      chat_count: 0,
      message_count: 0,
      thought_count: 0,
    });
  });

  it("convertFiles 在任一文件解析失败时附带文件名错误前缀", () => {
    const files = [
      { name: "ok.md", text: "#### User:\nhi\n#### Assistant:\nyo" },
      { name: "broken.md", text: "没有角色标记" },
    ];
    assert.throws(
      () => convertFiles(files, "llama3", false),
      (err) => err instanceof Error && err.message.startsWith("broken.md: 未找到"),
    );
  });
});
