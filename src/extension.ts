/// <reference lib="dom" />
import * as vscode from 'vscode';
import ChatgptViewProvider from './chatgpt-view-provider';
import { registerCommands, setRightMenu } from './commands';
import { configManager } from './config';
import { i18n } from './i18n';

export async function activate(context: vscode.ExtensionContext) {
  // 1. 初始化配置与国际化支持
  configManager.init(context);
  i18n.init(context);

  // 2. 注册webview
  const chatGptViewProvider = new ChatgptViewProvider(context);
  const webviewViewProvider = vscode.window.registerWebviewViewProvider(
    'vscode-chatgpt-plugin.view',
    chatGptViewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true, // webview被隐藏时保持状态，避免被重置
      },
    },
  );

  // 3. 注册所有的扩展命令
  registerCommands(context, chatGptViewProvider);

  // 4. 监听配置文件变更
  const vscodeConfigChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    // 关于chatgpt的配置发生变更后重新 init 模型
    if (
      event.affectsConfiguration('chatgpt.gpt.apiBaseUrl') ||
      event.affectsConfiguration('chatgpt.gpt.model') ||
      event.affectsConfiguration('chatgpt.gpt.organization') ||
      event.affectsConfiguration('chatgpt.gpt.maxTokens') ||
      event.affectsConfiguration('chatgpt.gpt.temperature') ||
      event.affectsConfiguration('chatgpt.gpt.reasoningEffort')
    ) {
      chatGptViewProvider.initConfig(true);
    }

    if (
      // 监听 promptPrefix 配置变更，重新设置右键菜单
      event.affectsConfiguration('chatgpt.promptPrefix')
    ) {
      setRightMenu();
    }
  });

  context.subscriptions.push(webviewViewProvider, vscodeConfigChanged);

  // 5. 更新右键菜单的启用状态
  setRightMenu();
}

export function deactivate() {}
