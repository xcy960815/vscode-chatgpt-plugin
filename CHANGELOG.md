# Changelog

All notable changes to the "vscode-chatgpt-plugin" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added

- Support for `reasoningEffort` config (`low` / `medium` / `high`) for o-series reasoning models.
- New models to the enum: `gpt-4o-2024-11-20`, `o3`, `o3-mini`, `o4-mini`.
- Husky v9 + lint-staged for pre-commit ESLint and Prettier checks.
- commitlint for Conventional Commits enforcement on commit messages.
- `.editorconfig` for consistent editor settings across contributors.
- `.prettierignore` to exclude build artifacts from formatting.
- New npm scripts: `lint`, `lint:fix`, `format`, `format:check`.
- Bilingual README: English (`README.md`) and Chinese (`README.zh-CN.md`).

### Changed

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
