# 迁移与重构计划 (Migration & Refactoring Plan)

## 1. 迁移至 `openai-node` 的 Todo List

目前项目使用了手写的 `isomorphic-fetch` + 自定义 SSE 流式解析，并且为了兼容已过时的模型而维护了两套 API 类 (`GptModelAPI` 和 `TextModleAPI`)。我们将完全迁移到官方的 Node.js SDK。

### 📦 依赖调整 (package.json)

- [ ] **添加新依赖**: 安装官方提供的 `openai` 库 (`npm install openai`)。
- [ ] **移除旧网络库**: 删除 `isomorphic-fetch`、`node-fetch` 等不再需要的包。
- [ ] **移除 SSE 解析库**: 官方 SDK 原生支持异步迭代流，移除自封装的流解析依赖（如 `eventsource-parser`）。
- [ ] **移除/替换分词器**: 移除 `gpt3-tokenizer`，如果后续仍需 Token 计算，建议替换为基于 tiktoken 的现代化工具包。

### 🗑️ 清理废弃代码与配置

- [ ] **移除 `TextModleAPI`**: 老模型已无需兼容，直接删除 `src/text-model-api.ts`。
- [ ] **删除冗余工具**: 清除 `src/utils.ts` 中手写的 `fetchSSE` 函数。
- [ ] **更新配置项**: 在 `package.json` 的 `chatgpt.gpt.model` 选项中，移除 `text-davinci-*` 模型，补充 `gpt-4-turbo`、`gpt-4o` 等新模型。

### 🛠️ 重构核心请求逻辑 (`GptModelAPI`)

- [ ] **实例化 OpenAI 客户端**: 初始化官方提供的 `new OpenAI({ apiKey, baseURL, organization })` 实例。
- [ ] **重构 `sendMessage`**: 使用 `openai.chat.completions.create` 替换手写网络请求。
- [ ] **重构流式处理 (Streaming)**: 将手动拼装 `[DONE]` 的流式接收逻辑，替换为原生的 `for await (const chunk of stream)` 迭代模式。
- [ ] **重构超时控制**: 利用 `openai-node` 自带的 timeout 机制和 `AbortController` 替换 `p-timeout` 包。

### 🔄 会话上下文与类型适配

- [ ] **统一消息类型**: 将代码中的自建类型统一改为官方提供的 `OpenAI.Chat.ChatCompletionMessageParam` 类型。
- [ ] **上下文缓存调整**: 确保从 `Keyv` 中提取和恢复的数据结构完全吻合官方 SDK 接受的 messages 数组。

### 🧪 编译与测试

- [ ] **修复上层调用**: 在 `src/chatgpt-view-provider.ts` 中移除一切对 `textModel` 的检查和调用。
- [ ] **运行测试**: 验证插件能够在本地正确加载 `openai` 依赖，并成功建立对话。

---

## 2. 现有代码架构的优化分析

除了替换底层的 OpenAI 调用方式，我也非常认同你所说的——目前的**代码结构确实存在比较明显的设计问题，显得非常臃肿和耦合**。

具体的痛点以及重构建议如下：

### 痛点 1: `ChatgptViewProvider` 是一个严重的“上帝类” (God Object)

`src/chatgpt-view-provider.ts` 高达 700 多行，承担了太多完全不相关的职责：

- **Webview 生命周期管理** (HTML 渲染、消息监听)
- **i18n 国际化读取与解析** (`loadLanguage`)
- **VS Code 配置项的读取** (满屏幕的 `this.chatGptConfig.get(...)`)
- **OpenAI 实例的管理与调用** (`sendApiRequest`, `initChatGPTModel`, Token 判断等)
- **API Key 校验与弹窗交互逻辑** (`promptApiKey`, `showNoApiKeyInput`)

**优化建议**：

1. **抽离配置层 (Config Manager)**: 专门写一个单例或类 `ConfigurationManager`，负责统一读取和监听 Workspace 的配置。
2. **抽离 API 交互层 (Service)**: Webview 只负责发消息，由专门的 `ChatService` 或 `OpenAIService` 负责维护上下文缓存与发起请求。
3. **抽离 i18n 工具类**: 将语言加载器分离出去。

### 痛点 2: `extension.ts` 中的命令注册缺乏模块化

目前的 `extension.ts` 将所有的右键菜单命令（addTests、findBugs 等）以及插件启动逻辑全部平铺在一个巨大的 `activate` 函数里。

**优化建议**：

- **命令注册工厂化**: 拆分出专门的 `commandRegister.ts`，将右键菜单行为抽象为一套统一的函数接口进行注册，使得主入口 `extension.ts` 保持在 50 行以内，清晰明了。

### 痛点 3: 自定义的 Token 缓存系统难以维护

现在的项目用 `Keyv` 手动存取了 Message 及其 ParentID 的链表结构，这种做法其实容易引发混乱，一旦遇到截断问题就容易卡死。

**优化建议**：

- 新版的 `openai-node` 让维持对话记录变得更容易，可以直接通过维护一个明确的 `messages` 内存数组进行管理。如果依然需要做本地持久化，可以设计一套更加清晰的会话管理器(Session Manager)。

---

**结论**：在替换 OpenAI SDK 的同时，建议配合进行“解耦设计”，尤其是拆分 `ChatgptViewProvider`。这能极大提升该插件后续增加功能（例如多端点、历史记录、上下文变量管理）的可维护性。
