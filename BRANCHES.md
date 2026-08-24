# 分支说明

本仓库有两个分支：`main`（当前默认分支）和 `archive`（归档分支）。

## 背景

仓库最早是一个 Python/FastAPI 本地网页服务，需要安装 Python 并在本机启动
服务器才能使用。后来把解析和转换逻辑全部移植到了浏览器端 JavaScript，
做成了一个无需任何后端的纯静态网页，并部署到了 GitHub Pages。

- **`main`** — 新版本：纯静态 GitHub Pages 站点，即 <https://ccawmiku.github.io/md-to-openwebui/>
- **`archive`** — 旧版本：Python/FastAPI 本地服务，外加 Windows EXE 打包脚本

## 功能对比

| 功能 | `main`（静态版） | `archive`（Python 版） |
| --- | --- | --- |
| 部署方式 | GitHub Pages，纯静态，零依赖 | 本机 Python 3.11+ / 或编译成 EXE |
| 转换位置 | 浏览器内（JavaScript） | 本地服务器（Python） |
| 是否需要 Python | 否 | 是 |
| 是否需要启动服务器 | 否，打开网页即用 | 是（`md-to-openwebui` 命令） |
| Windows EXE | 无 | 有（PyInstaller 构建） |
| API 接口 | 无 | 有（`/api/convert`、`/api/docs`） |
| 文件处理 | 只在浏览器内存中，不上传 | 只在本地服务器内存中，不落盘 |
| 解析/转换逻辑 | `app.js` | `src/md_to_openwebui/{parser,converter}.py` |
| 测试 | 无自动化测试 | pytest + mypy + ruff |
| 转换能力 | 完全一致 | 完全一致 |

两者的**转换能力完全相同**：支持批量文件、Thoughts 思考段拆分、模型名称必填、
输出结构一致（Open WebUI 导入标准消息树）。

## 如何运行各版本

### `main` 静态版

- 在线：直接访问 <https://ccawmiku.github.io/md-to-openwebui/>
- 本地：打开 `index.html`，或 `python -m http.server` 后访问本机端口

### `archive` Python 版

```powershell
git checkout archive
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.lock
.venv\Scripts\python -m pip install -e . --no-deps
.venv\Scripts\md-to-openwebui
```

或在 GitHub Releases / Actions 构件中下载 `md-to-openwebui.exe` 直接运行。

## 建议

日常使用请用 `main` 的静态版——无需安装、打开即用、部署简单。若需要离线
单文件 EXE、或在无浏览器的环境中调用转换 API，则用 `archive` 分支。
