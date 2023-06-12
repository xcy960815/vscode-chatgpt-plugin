# 变更日志

“vscode-chatgpt-plugin”扩展的所有显着变化都将记录在此文件中。

查看 [Keep a Changelog](http://keepachangelog.com/) 以获得有关如何构建此文件的建议。

## [Unreleased]

<br/>

### Fixed

- 修复了当 token 超长时，右下角提示框无选项的问题。

<br/>

### Feat

- 优化 text 模型构建 prompt 的逻辑。
- 去除点击登录无用操作。
- 下线 text-curie-001, text-babbage-001, text-ada-001 较为古老的模型，增加 text-davinci-002 模型。
- 优化 REDME.md 文档样式。

<br/>

### Feat

- 整合声明，把重复的声明进行抽离，统一继承。
