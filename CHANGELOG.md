# Changelog

All notable changes to the "vscode-chatgpt-plugin" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added

- **Code operations (roadmap 3.2)**
  - "Apply" button on AI code blocks to intelligently merge AI code into the active editor using a native Diff view (`TextDocumentContentProvider`).
  - "Ask ChatGPT" right-click context menu command to quickly attach the selected code as context and focus the chat input.
- **Context awareness (roadmap 3.1)** — the extension now understands your editing context.
  - "Attach current file" button (📎) next to the input box — one-click to include the active editor's full file content in the prompt, displayed as a removable chip above the textarea.
  - Right-click commands (Explain, Optimize, Find Bugs, etc.) now automatically embed the file language and filename into the prompt for better AI responses.
  - Token usage progress bar — a thin bar below the input box estimates token count (chars / 4) and turns orange when exceeding 80% of the model context window.
- `get-current-file` / `current-file-data` message types for frontend-backend file attachment communication.
- `handleGetCurrentFile()` method in `ChatgptViewProvider` to read the active editor's file info.
- `buildQuestion()` now wraps code in fenced code blocks and prepends `[language, file]` context metadata.
- i18n key: `attachFileButtonTitle` (EN + ZH-CN).
- **Conversation history persistence** — conversations are now saved to `globalState` and survive window close/reopen.
  - `conversation-store.ts` — new module managing history CRUD (save/load/delete/clear, max 20 conversations).
  - History panel in the webview with click-to-restore and delete buttons.
  - Auto-generated titles from the first user message (first 30 chars).
  - "History" button in the more-actions menu to toggle the panel.
  - `load-history`, `load-conversation`, `delete-conversation` message types for frontend-backend communication.
- `OpenAIService.getConversationMessages()` — expose user/assistant messages for persistence.
- `OpenAIService.loadConversation()` — restore API context from saved messages.
- i18n keys: `historyTitle`, `historyEmpty`, `historyButtonName`, `historyButtonTitle` (EN + ZH-CN).
- History panel CSS with hover highlights, active state, and delete buttons.

### Changed

- Textarea layout restructured: action buttons and token bar are now embedded inside the textarea wrapper (ChatGPT/Claude-style), using a flex-column wrapper with grid-based auto-height inner and negative-margin footer overlay.
- `sendApiRequest` now creates a single conversation ID per session (not per question) and saves to history after each response.
- `clearSession` now also wipes all persisted conversation history.
- `clear-conversation` resets `currentConversationId` so the next question starts a fresh conversation.
- `resolveWebviewView` sends history list to the frontend on panel open.
- Support for `reasoningEffort` config (`low` / `medium` / `high`) for o-series reasoning models.
- New models to the enum: `gpt-4o-2024-11-20`, `o3`, `o3-mini`, `o4-mini`.
- Husky v9 + lint-staged for pre-commit ESLint and Prettier checks.
- commitlint for Conventional Commits enforcement on commit messages.
- `.editorconfig` for consistent editor settings across contributors.
- `.prettierignore` to exclude build artifacts from formatting.
- New npm scripts: `lint`, `lint:fix`, `format`, `format:check`.
- Bilingual README: English (`README.md`) and Chinese (`README.zh-CN.md`).
- Migrated `maxTokens` default from `1024` → `4096` (package.json and config.ts aligned).
- Migrated `temperature` default from `1` → `0.2` (package.json and config.ts aligned).
- Upgraded Husky from v1 to v9, using `.husky/` directory instead of package.json config.
- Replaced `pretty-quick` with `lint-staged` for more granular pre-commit checks.
- Replaced `vcm-cli` with `commitlint` + `@commitlint/config-conventional`.
- Upgraded Volta Node version from `16.20.0` to `20.18.0` (required by new toolchain).
- Formatted all source files with Prettier.

### Removed

- `top_p` config — redundant when used alongside `temperature`; removed from package.json, config.ts, extension.ts, and NLS files.
- `withContent` config — no longer used after the OpenAI SDK migration; removed from package.json, config.ts, and extension.ts.
- Conflicting `.prettierrc.js` (kept `.prettierrc` as single source of truth).
- Boilerplate `vsc-extension-quickstart.md`.

### Fixed

- DOM overwrite bug: all `add-answer` messages used `currentConversationId` as DOM element ID, causing every answer in a conversation to overwrite the first answer bubble. Each request now generates a unique `currentMessageId`.
- Frontend prompt concatenation leaked file content into the user bubble; `attachedContent` is now sent as a separate field and only concatenated on the backend.
- Token progress bar did not include history messages in its estimate; now counts all `.msg-content` elements.
- `clearSession()` did not send `clear-conversation` to the webview, leaving stale messages on screen.
- Token bar showed "~1 tokens" on empty input due to history characters; label now only appears when the user has typed content.
- o-series reasoning models no longer receive `temperature` parameter (API would reject it); `reasoning_effort` is sent instead.

---

## [0.1.4] — Previous Releases

### Added

- Custom model name input field in settings.
- Reordered config items to surface frequently used settings.
- "Update API Key" button for managing keys stored in global state.
- Support for `gpt-4-0613`, `gpt-4-32k`, `gpt-4-32k-0613` models.
- Support for `gpt-3.5-turbo-16k`, `gpt-3.5-turbo-0613`, `gpt-3.5-turbo-16k-0613` models.
- Internationalization support (English and Chinese).

### Fixed

- Error messages for HTTP 400/401/403/404/429/500 were being swallowed by overly long context error dialogs.
- Input box height not restoring after losing focus.
- "Update settings" and "Update prompts" button titles displaying incorrectly.

### Changed

- Removed legacy webview.js file.
- Removed unused i18n config entries from settings.
- Refactored code structure for better readability and maintainability.
- Consolidated duplicated type declarations with unified inheritance.
- Optimized prompt construction logic for text models.
