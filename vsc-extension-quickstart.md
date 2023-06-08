## 运行测试

- 打开调试 viewlet（在 Mac 上为 `Ctrl+Shift+D` 或 `Cmd+Shift+D`），然后从启动配置下拉列表中选择 `Extension Tests`。
- 按“F5”在加载扩展的新窗口中运行测试。
- 在调试控制台中查看测试结果的输出。
- 更改 `src/test/suite/extension.test.ts` 或在 `test/suite` 文件夹中创建新的测试文件。
  - 提供的测试运行器将只考虑匹配名称模式 `**.test.ts` 的文件。
  - 您可以在 `test` 文件夹内创建文件夹，以按照您想要的方式构建测试。

## 未来

- 通过 [捆绑您的扩展](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) 减小扩展大小并缩短启动时间。
- [在 VS 代码扩展市场上发布您的扩展](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
- 通过设置 [持续集成](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) 自动构建。
