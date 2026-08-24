# Markdown → Open WebUI

一个纯前端网页转换器：把由 `#### User:` / `#### Assistant:` 组成的 Markdown
聊天记录转换为 Open WebUI 可直接导入的标准 JSON 消息树。

**全程在浏览器内完成，不需要服务器，文件不会离开你的设备。**

## 在线使用

直接打开 GitHub Pages 站点：

<https://ccawmiku.github.io/md-to-openwebui/>

## 本地使用

把本仓库下载或克隆到本地后，直接用浏览器打开 `index.html`，或用任意静态
文件服务器托管本目录：

```powershell
python -m http.server 8000
# 然后打开 http://localhost:8000
```

## 特点

- 支持一次选择或拖入多个 `.md` 文件
- 每个 Markdown 文件转换为一段独立对话
- 保留中文、Markdown、段落和消息顺序
- 可在下载前查看对话数、消息数和 JSON 预览
- 文件只在浏览器内存中处理，不上传、不保存到磁盘
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

## 导入 Open WebUI

转换并下载 JSON 后，在 Open WebUI 中进入：

`设置 → 数据控制 → 导入聊天记录`

也可以把 JSON 文件拖到 Open WebUI 侧边栏。重复导入会创建重复对话。

## 限制

- 最多同时转换 50 个文件
- 单个文件不超过 10 MiB，总大小不超过 50 MiB
- 输入文件必须是 UTF-8 编码
- 当前仅映射 `User` 和 `Assistant` 两种角色

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

模型名称为必填项，会写入对话模型列表和每条助手消息。

转换页面的“保留思考过程”默认关闭，此时会彻底丢弃思考内容；开启后，思考内容会写入 Open WebUI 助手消息的 `output` reasoning 项。

## 分支说明

`main` 分支是当前的纯静态 GitHub Pages 版本；`archive` 分支保留了早期的
Python/FastAPI 本地服务版本。两者区别详见 [BRANCHES.md](./BRANCHES.md)。
