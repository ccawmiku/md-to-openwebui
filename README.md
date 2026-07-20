# Markdown → Open WebUI

一个本地网页转换器：把由 `#### User:` / `#### Assistant:` 组成的 Markdown
聊天记录转换为 Open WebUI 可直接导入的标准 JSON 消息树。

## 特点

- 支持一次选择或拖入多个 `.md` 文件
- 每个 Markdown 文件转换为一段独立对话
- 保留中文、Markdown、段落和消息顺序
- 可在下载前查看对话数、消息数和 JSON 预览
- 文件只在浏览器与本地服务的内存中处理，不会保存到磁盘
- 无外部前端资源、无遥测、无数据库

## 输入格式

```markdown
# 对话标题

#### User:
你好
---

#### Assistant:
你好！
---
```

角色标题不区分大小写。一级标题会成为 Open WebUI 中的对话标题；没有一级标题时使用文件名。

## 本地运行

需要 Python 3.11 或更高版本。

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.lock
.venv\Scripts\python -m pip install -e . --no-deps
.venv\Scripts\md-to-openwebui
```

然后打开 <http://127.0.0.1:8000>。

如需开发和运行测试：

```powershell
.venv\Scripts\python -m pip install -r requirements-dev.lock
.venv\Scripts\python -m pip install -e . --no-deps
.venv\Scripts\python -m pytest --cov
.venv\Scripts\python -m ruff check .
.venv\Scripts\python -m mypy
.venv\Scripts\python -m build
```

## 导入 Open WebUI

转换并下载 JSON 后，在 Open WebUI 中进入：

`设置 → 数据控制 → 导入聊天记录`

也可以把 JSON 文件拖到 Open WebUI 侧边栏。重复导入会创建重复对话。

## 限制

- 最多同时转换 50 个文件
- 单个文件不超过 10 MiB，总大小不超过 50 MiB
- 输入文件必须是 UTF-8 编码
- 当前仅映射 `User` 和 `Assistant` 两种角色

## API

- `GET /api/health`：健康检查
- `POST /api/convert`：转换 Base64 编码的内存文件
- `GET /api/docs`：交互式 API 文档

请求示例：

```json
{
  "files": [
    {
      "name": "chat.md",
      "data_base64": "IyDlr7nor53moIfpopgKLi4u"
    }
  ],
  "model": null
}
```

响应中的 `output` 数组就是 Open WebUI 导入文件的内容。

## Windows EXE

下载 `md-to-openwebui.exe` 后直接双击。程序会启动仅监听本机的服务，并自动打开默认浏览器；关闭控制台窗口即可停止服务。EXE 不需要预装 Python。

本地重新构建：

```powershell
.venv\Scripts\python -m pip install -r requirements-dev.lock
.\scripts\build_exe.ps1 -Python .venv\Scripts\python.exe
```

每个版本标签也会通过 GitHub Actions 构建 Windows EXE，并保存为工作流构件。

## Thoughts 思考段

导出文件中位于用户提示词之后、下一条助手回答之前的 `**Thoughts:**` 会从用户内容中拆出：

```markdown
#### User:
实际提示词
---
**Thoughts:**
模型的思考内容
---
#### Assistant:
最终回答
---
```

转换时会识别并彻底丢弃思考内容。导出的 JSON 只保留用户提示词和助手最终回答，不会生成 `output`、`reasoning` 等扩展字段，以兼容 Open WebUI 的聊天导入器。
