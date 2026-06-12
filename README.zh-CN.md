<h1 align="center">
  <img src="./images/ai-logo.jpg" alt="VS Code ChatGPT Plugin" width="80" />
  <br />
  VS Code ChatGPT 插件
</h1>

<p align="center">
  在编辑器中与 GPT 对话、生成代码、获取 AI 智能建议。
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=xcy960815.vscode-chatgpt-plugin">
    <img src="https://img.shields.io/visual-studio-marketplace/v/xcy960815.vscode-chatgpt-plugin?label=VS%20Code%20%E5%95%86%E5%BA%97&color=blue" alt="VS Code 商店" />
  </a>
  <a href="https://github.com/xcy960815/vscode-chatgpt-plugin/blob/main/LICENSE.md">
    <img src="https://img.shields.io/github/license/xcy960815/vscode-chatgpt-plugin" alt="开源协议" />
  </a>
  <a href="https://conventionalcommits.org">
    <img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg" alt="约定式提交" />
  </a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a>
</p>

---

## 功能特性

- **对话式 AI** — 在侧边栏面板中与 GPT 模型实时对话，支持流式响应和 Markdown 渲染。
- **代码操作** — 选中代码后右键，可添加测试、查找 Bug、优化代码、解释代码、添加注释或补全代码。
- **现代化 UI** — 纯 CSS 设计，完全跟随 VS Code 主题，支持深色/浅色模式、消息气泡和平滑动画。
- **开发者友好默认值** — `temperature: 0.2` 确保代码输出稳定确定，`maxTokens: 4096` 支持长文本生成。
- **推理模型支持** — 原生支持 OpenAI o 系列推理模型（`o1`、`o3`、`o3-mini`、`o4-mini`），可配置 `reasoningEffort`。
- **国际化** — 内置中文和英文支持。

## 支持的模型

| 类别     | 模型                                         |
| -------- | -------------------------------------------- |
| GPT-4o   | `gpt-4o`、`gpt-4o-mini`、`gpt-4o-2024-11-20` |
| 推理模型 | `o4-mini`、`o3`、`o3-mini`、`o1`、`o1-mini`  |
| 旧版模型 | `gpt-4-turbo`、`gpt-4`、`gpt-3.5-turbo`      |

也可以通过 `chatgpt.gpt.customModel` 设置项输入任意自定义模型名称。

## 前提条件

- **VS Code** `>= 1.73.0`
- **OpenAI API 密钥** — [点击获取](https://platform.openai.com/account/api-keys)
- 网络可访问 `https://api.openai.com`（或自定义 API 地址）

## 安装

1. 打开 VS Code，进入扩展面板（`Ctrl+Shift+X` / `Cmd+Shift+X`）。
2. 搜索 **vscode-chatgpt-plugin**。
3. 点击 **安装**。

## 配置项

在设置中搜索 `chatgpt` 即可查看所有选项：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `chatgpt.gpt.apiKey` | — | OpenAI API 密钥（安全存储在全局状态中） |
| `chatgpt.gpt.model` | `gpt-4o-mini` | 使用的语言模型 |
| `chatgpt.gpt.customModel` | — | 覆盖为任意自定义模型名称 |
| `chatgpt.gpt.reasoningEffort` | `medium` | o 系列推理模型的推理力度：`low` / `medium` / `high` |
| `chatgpt.gpt.maxTokens` | `4096` | 响应的最大 Token 数 |
| `chatgpt.gpt.temperature` | `0.2` | 采样温度（o 系列推理模型会忽略此设置） |
| `chatgpt.gpt.apiBaseUrl` | `https://api.openai.com` | 自定义 API 地址 |
| `chatgpt.gpt.organization` | — | OpenAI 组织 ID |
| `chatgpt.gpt.systemMessage` | _（内置）_ | 自定义系统提示词 |
| `chatgpt.response.autoScroll` | `true` | 自动滚动到最新消息 |
| `chatgpt.response.subscribeToResponse` | `false` | AI 回复时发送通知 |

## 使用方法

### 自由对话

在聊天面板底部的输入框中输入任意内容，按 **Enter** 即可开始对话。

<p align="center">
  <img src="./imgs/any-question.jpg" alt="对话界面" width="500" />
</p>

### 代码操作

在编辑器中选中代码，右键点击，从上下文菜单中选择操作：

- **添加测试** — 为选中代码生成单元测试
- **查找错误** — 识别潜在问题
- **优化代码** — 提供性能和可读性改进建议
- **解释代码** — 获取通俗易懂的代码解释
- **添加注释** — 插入有意义的注释
- **补全代码** — 自动补全选中的代码片段
- **临时提示** — 将选中代码与自定义 Prompt 一起发送

<p align="center">
  <img src="./imgs/right-menu.png" alt="右键菜单" width="500" />
</p>

### API 密钥配置

首次启动时，点击聊天面板中的 **登录** 按钮。如果未检测到 API 密钥，系统会弹窗提示输入。密钥默认存储在 VS Code 的全局状态中，不会写入 `settings.json`。

<p align="center">
  <img src="./imgs/setting.jpg" alt="设置" width="500" />
</p>

## 开发

### 环境要求

- **Node.js** `>= 20`（通过 [Volta](https://volta.sh) 管理）
- **npm**（随 Node.js 一起安装）

### 快速开始

```bash
git clone https://github.com/xcy960815/vscode-chatgpt-plugin.git
cd vscode-chatgpt-plugin
npm install
```

### 脚本命令

| 命令                   | 说明                                  |
| ---------------------- | ------------------------------------- |
| `npm run build`        | 使用 esbuild 构建扩展（含 sourcemap） |
| `npm run watch`        | 监听模式构建，用于开发                |
| `npm run lint`         | 对源文件运行 ESLint 检查              |
| `npm run lint:fix`     | 自动修复 ESLint 问题                  |
| `npm run format`       | 使用 Prettier 格式化代码              |
| `npm run format:check` | 仅检查格式，不修改文件                |
| `npm run test`         | 运行 ESLint + TypeScript 类型检查     |

### Git Hooks

本项目使用 [Husky](https://typicode.github.io/husky/) 配合 [lint-staged](https://github.com/okonet/lint-staged) 和 [commitlint](https://commitlint.js.org/)：

- **pre-commit** — 对暂存文件运行 ESLint 自动修复和 Prettier 格式化。
- **commit-msg** — 校验 commit message 是否符合 [约定式提交](https://www.conventionalcommits.org/) 规范（如 `feat:`、`fix:`、`docs:`、`chore:`）。

### 项目结构

```
src/
├── extension.ts              # 入口文件 — 激活、配置监听
├── chatgpt-view-provider.ts  # WebView 面板逻辑
├── commands.ts               # 命令注册
├── config.ts                 # 统一配置管理
├── i18n.ts                   # 国际化工具
├── openai-service.ts         # OpenAI SDK 封装
└── test/                     # 测试套件
```

## 开发路线图

查看 [docs/roadmap.md](./docs/roadmap.md) 了解完整的开发路线图和当前进度。

## 参与贡献

欢迎贡献代码！请遵循 [约定式提交](https://www.conventionalcommits.org/) 规范编写 commit message。

## 开源协议

本项目基于 [MIT 协议](./LICENSE.md) 开源。
