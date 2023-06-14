/// <reference lib="dom" />
import * as vscode from 'vscode';
import ChatgptViewProvider from './chatgpt-view-provider';

const menuCommands = [
  'addTests',
  'findBugs',
  'optimize',
  'explain',
  'addComments',
  'completeCode',
  'adhoc',
  'customPrompt1',
  'customPrompt2',
];

export async function activate(context: vscode.ExtensionContext) {
  // 注册webview
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

  // 注册 freeText 命令
  const freeTextCommand = vscode.commands.registerCommand('vscode-chatgpt.freeText', async () => {
    const inputBoxPrompt =
      vscode.workspace
        .getConfiguration('chatgpt')
        .get<string>('pageMessage.askAnything.inputBox.prompt') || '';
    const value = await vscode.window.showInputBox({
      prompt: inputBoxPrompt,
    });
    if (value) {
      chatGptViewProvider?.sendApiRequest(value, { command: 'freeText' });
    }
  });

  // 注册清空对话命令
  const clearConversationCommand = vscode.commands.registerCommand(
    'vscode-chatgpt.clearConversation',
    async () => {
      chatGptViewProvider?.sendMessageToWebview({ type: 'clear-conversation' }, true);
    },
  );

  // 注册导出对话命令
  const exportConversationCommand = vscode.commands.registerCommand(
    'vscode-chatgpt.exportConversation',
    async () => {
      chatGptViewProvider?.sendMessageToWebview({ type: 'export-conversation' }, true);
    },
  );

  // 注册 clearSession 命令
  const clearSessionCommand = vscode.commands.registerCommand('vscode-chatgpt.clearSession', () => {
    context.globalState.update('chatgpt-gpt-apiKey', null);
    chatGptViewProvider?.clearSession();
  });

  const vscodeConfigChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    // 关于chatgpt的配置发生变更后重新 init 模型
    if (
      event.affectsConfiguration('chatgpt.gpt.apiBaseUrl') ||
      event.affectsConfiguration('chatgpt.gpt.model') ||
      event.affectsConfiguration('chatgpt.gpt.organization') ||
      event.affectsConfiguration('chatgpt.gpt.maxTokens') ||
      event.affectsConfiguration('chatgpt.gpt.temperature') ||
      event.affectsConfiguration('chatgpt.gpt.top_p') ||
      event.affectsConfiguration('chatgpt.gpt.withContent')
    ) {
      chatGptViewProvider.initConfig(true);
    }

    if (
      // 监听 addTests,findBugs,optimize,explain,addComments,completeCode,adhoc,customPrompt1,customPrompt2 配置变更，重新设置右键菜单
      event.affectsConfiguration('chatgpt.promptPrefix')
    ) {
      setRightMenu();
    }
  });

  // 自定义指令1 vscode-chatgpt.customPrompt1
  const customPrompt1Command = vscode.commands.registerCommand(
    'vscode-chatgpt.customPrompt1',
    async () => {
      const activeTextEditor = vscode.window.activeTextEditor;
      if (!activeTextEditor) {
        return;
      }
      // 添加trim 为了防止用户选择 空代码
      const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
      if (!selectedCode) {
        return;
      }
      // 从配置文件中获取用户输入的临时指令的标题、提示、占位符
      let customPrompt1 = vscode.workspace
        .getConfiguration('chatgpt')
        .get<string>(`promptPrefix.customPrompt1`);
      if (!customPrompt1) {
        const title = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand1.inputBox.title');
        const prompt = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand1.inputBox.prompt');
        const placeHolder = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand1.inputBox.placeholder');
        customPrompt1 = await vscode.window.showInputBox({
          title,
          prompt,
          ignoreFocusOut: true,
          placeHolder,
          value: '',
        });
        customPrompt1 = customPrompt1?.trim();
        if (!customPrompt1) {
          return;
        }
        // 更新配置文件
        vscode.workspace
          .getConfiguration('chatgpt')
          .update(`promptPrefix.customPrompt1`, customPrompt1, true);
      }
      chatGptViewProvider?.sendApiRequest(customPrompt1, {
        command: 'customPrompt1',
        code: selectedCode,
        language: activeTextEditor.document.languageId,
      });
    },
  );

  // 自定义指令2 vscode-chatgpt.customPrompt2
  const customPrompt2Command = vscode.commands.registerCommand(
    'vscode-chatgpt.customPrompt2',
    async () => {
      const activeTextEditor = vscode.window.activeTextEditor;
      if (!activeTextEditor) {
        return;
      }
      // 添加trim 为了防止用户选择 空代码
      const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
      if (!selectedCode) {
        return;
      }
      // 从配置文件中获取用户输入的临时指令的标题、提示、占位符
      let customPrompt2 = vscode.workspace
        .getConfiguration('chatgpt')
        .get<string>(`promptPrefix.customPrompt2`);
      if (!customPrompt2) {
        const title = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand2.inputBox.title');
        const prompt = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand2.inputBox.prompt');
        const placeHolder = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>('pageMessage.customCommand2.inputBox.placeholder');
        customPrompt2 = await vscode.window.showInputBox({
          title,
          prompt,
          ignoreFocusOut: true,
          placeHolder,
          value: '',
        });
        customPrompt2 = customPrompt2?.trim();
        if (!customPrompt2) {
          return;
        }
        // 更新配置文件
        vscode.workspace
          .getConfiguration('chatgpt')
          .update(`promptPrefix.customPrompt2`, customPrompt2, true);
      }
      chatGptViewProvider?.sendApiRequest(customPrompt2, {
        command: 'customPrompt2',
        code: selectedCode,
        language: activeTextEditor.document.languageId,
      });
    },
  );

  // 临时指令的内容
  const originalAdhocPrompt: string = context.globalState.get('chatgpt-adhoc-prompt') || '';
  // 注册 添加临时指令
  const adhocCommand = vscode.commands.registerCommand('vscode-chatgpt.adhoc', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    // 添加trim 为了防止用户选择 空代码
    const selectedCode = editor.document.getText(editor.selection).trim();
    if (!selectedCode) {
      return;
    }

    // 从配置文件中获取用户输入的临时指令的标题、提示、占位符
    const title = vscode.workspace
      .getConfiguration('chatgpt')
      .get<string>('pageMessage.adhocCommand.inputBox.title');
    const prompt = vscode.workspace
      .getConfiguration('chatgpt')
      .get<string>('pageMessage.adhocCommand.inputBox.prompt');
    const placeHolder = vscode.workspace
      .getConfiguration('chatgpt')
      .get<string>('pageMessage.adhocCommand.inputBox.placeHolder');
    // 创建一个输入框，让用户输入临时指令
    let adhocPrompt = await vscode.window.showInputBox({
      title,
      prompt,
      ignoreFocusOut: true,
      placeHolder,
      value: originalAdhocPrompt,
    });
    adhocPrompt = adhocPrompt?.trim();

    if (!adhocPrompt) {
      return;
    }
    // 保存用户输入的临时指令
    context.globalState.update('chatgpt-adhoc-prompt', adhocPrompt);
    chatGptViewProvider?.sendApiRequest(adhocPrompt, {
      command: 'adhoc',
      code: selectedCode,
    });
  });

  // 注册菜单命令
  const registeredCommands = menuCommands
    .filter((command) => !['adhoc', 'customPrompt1', 'customPrompt2'].includes(command))
    .map((command) =>
      vscode.commands.registerCommand(`vscode-chatgpt.${command}`, () => {
        // 获取配置的 prompt
        const prompt = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>(`promptPrefix.${command}`);
        // 获取当前编辑器
        const activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor) {
          // 获取选中的文本
          const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
          if (selectedCode && prompt) {
            chatGptViewProvider?.sendApiRequest(prompt, {
              command,
              code: selectedCode,
              language: activeTextEditor.document.languageId,
            });
          }
        }
      }),
    );

  context.subscriptions.push(
    webviewViewProvider,
    // openChatGptViewCommand,
    freeTextCommand,
    clearConversationCommand,
    exportConversationCommand,
    clearSessionCommand,
    vscodeConfigChanged,
    adhocCommand,
    customPrompt1Command,
    customPrompt2Command,
    ...registeredCommands,
  );

  // 更新右键菜单
  const setRightMenu = () => {
    menuCommands.forEach((command) => {
      const commandEnabled =
        vscode.workspace
          .getConfiguration('chatgpt.promptPrefix')
          .get<boolean>(`${command}-enabled`) || false;
      vscode.commands.executeCommand('setContext', `${command}-enabled`, commandEnabled);
    });
  };

  setRightMenu();
}

export function deactivate() {}
