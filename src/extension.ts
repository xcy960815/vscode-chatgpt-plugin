import * as vscode from 'vscode';
import ChatgptViewProvider from './chatgpt-view-provider';

const menuCommands = [
  'addTests',
  'findBugs',
  'optimize',
  'explain',
  'addComments',
  'completeCode',
  'generateCode',
  'customPrompt1',
  'customPrompt2',
  'adhoc',
];

export async function activate(context: vscode.ExtensionContext) {
  // vscode.commands.executeCommand(
  //   'workbench.action.openSettings'
  // );

  // 注册webview
  const chatGptViewProvider = new ChatgptViewProvider(context);
  const webviewViewProvider = vscode.window.registerWebviewViewProvider(
    'vscode-chatgpt.view',
    chatGptViewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true, // webview被隐藏时保持状态，避免被重置
      },
    },
  );
  // 注册 freeText 命令
  const freeTextCommand = vscode.commands.registerCommand('vscode-chatgpt.freeText', async () => {
    const value = await vscode.window.showInputBox({
      prompt: 'Ask anything...',
    });

    if (value) {
      chatGptViewProvider?.sendApiRequest(value, { command: 'freeText' });
    }
  });
  // 注册 clearConversation 命令
  const clearConversationCommand = vscode.commands.registerCommand(
    'vscode-chatgpt.clearConversation',
    async () => {
      chatGptViewProvider?.sendMessage({ type: 'clear-conversation' }, true);
    },
  );
  // 注册 exportConversation 命令
  const exportConversationCommand = vscode.commands.registerCommand(
    'vscode-chatgpt.exportConversation',
    async () => {
      chatGptViewProvider?.sendMessage({ type: 'export-conversation-to-markdown' }, true);
    },
  );
  // 注册 clearSession 命令
  const clearSessionCommand = vscode.commands.registerCommand('vscode-chatgpt.clearSession', () => {
    context.globalState.update('chatgpt-session-token', null);
    context.globalState.update('chatgpt-clearance-token', null);
    context.globalState.update('chatgpt-user-agent', null);
    context.globalState.update('chatgpt-gpt3-apiKey', null);
    chatGptViewProvider?.clearSession();
  });

  // 用于监听用户更改配置文件时的事件。当用户在 VS Code 的 "setting.json" 文件中更改了某个设置时，就会触发此事件。
  const configChanged = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('chatgpt.response.showNotification')) {
      chatGptViewProvider.subscribeToResponse =
        vscode.workspace.getConfiguration('chatgpt').get('response.showNotification') || false;
    }

    if (e.affectsConfiguration('chatgpt.response.autoScroll')) {
      chatGptViewProvider.autoScroll = !!vscode.workspace
        .getConfiguration('chatgpt')
        .get('response.autoScroll');
    }

    if (e.affectsConfiguration('chatgpt.useAutoLogin')) {
      chatGptViewProvider.useAutoLogin =
        vscode.workspace.getConfiguration('chatgpt').get('useAutoLogin') || false;
      context.globalState.update('chatgpt-session-token', null);
      context.globalState.update('chatgpt-clearance-token', null);
      context.globalState.update('chatgpt-user-agent', null);
    }

    if (e.affectsConfiguration('chatgpt.chromiumPath')) {
      chatGptViewProvider.setChromeExecutablePath();
    }

    if (e.affectsConfiguration('chatgpt.profilePath')) {
      chatGptViewProvider.setProfilePath();
    }

    if (e.affectsConfiguration('chatgpt.proxyServer')) {
      chatGptViewProvider.setProxyServer();
    }

    if (e.affectsConfiguration('chatgpt.method')) {
      chatGptViewProvider.setMethod();
    }

    if (e.affectsConfiguration('chatgpt.authenticationType')) {
      chatGptViewProvider.setAuthType();
    }

    if (e.affectsConfiguration('chatgpt.gpt3.model')) {
      chatGptViewProvider.model = vscode.workspace.getConfiguration('chatgpt').get('gpt3.model');
    }

    if (
      e.affectsConfiguration('chatgpt.gpt3.apiBaseUrl') ||
      e.affectsConfiguration('chatgpt.gpt3.model') ||
      e.affectsConfiguration('chatgpt.gpt3.organization') ||
      e.affectsConfiguration('chatgpt.gpt3.maxTokens') ||
      e.affectsConfiguration('chatgpt.gpt3.temperature') ||
      e.affectsConfiguration('chatgpt.gpt3.top_p')
    ) {
      chatGptViewProvider.prepareConversation(true);
    }

    if (
      e.affectsConfiguration('chatgpt.promptPrefix') ||
      e.affectsConfiguration('chatgpt.gpt3.generateCode-enabled') ||
      e.affectsConfiguration('chatgpt.gpt3.model') ||
      e.affectsConfiguration('chatgpt.method')
    ) {
      setContext();
    }
  });
  // 临时指令的内容
  const originalChatgptAdhocPrompt: string = context.globalState.get('chatgpt-adhoc-prompt') || '';
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
      .get<string>('pageMessage.adhocInputBox.title');
    const prompt = vscode.workspace
      .getConfiguration('chatgpt')
      .get<string>('pageMessage.adhocInputBox.prompt');
    const placeHolder = vscode.workspace
      .getConfiguration('chatgpt')
      .get<string>('pageMessage.adhocInputBox.placeHolder');
    // 创建一个输入框，让用户输入临时指令
    let chatgptAdhocPrompt = await vscode.window.showInputBox({
      title,
      prompt,
      ignoreFocusOut: true,
      placeHolder,
      value: originalChatgptAdhocPrompt,
    });
    chatgptAdhocPrompt = chatgptAdhocPrompt?.trim();

    if (!chatgptAdhocPrompt) {
      return;
    }
    // 保存用户输入的临时指令
    context.globalState.update('chatgpt-adhoc-prompt', chatgptAdhocPrompt);
    if (chatgptAdhocPrompt) {
      chatGptViewProvider?.sendApiRequest(chatgptAdhocPrompt, {
        command: 'adhoc',
        code: selectedCode,
      });
    }
  });

  // 注册 generateCode 命令
  const generateCodeCommand = vscode.commands.registerCommand(`vscode-chatgpt.generateCode`, () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const selectedCode = editor.document.getText(editor.selection).trim();
    if (selectedCode) {
      chatGptViewProvider?.sendApiRequest(selectedCode, {
        command: 'generateCode',
        language: editor.document.languageId,
      });
    }
  });

  // 注册菜单命令
  const registeredCommands = menuCommands
    .filter((command) => command !== 'adhoc' && command !== 'generateCode')
    .map((command) =>
      vscode.commands.registerCommand(`vscode-chatgpt.${command}`, () => {
        // 获取配置的 prompt
        const prompt = vscode.workspace
          .getConfiguration('chatgpt')
          .get<string>(`promptPrefix.${command}`);
        // 获取当前编辑器
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
          return;
        }
        // 获取选中的文本
        const selectedCode = editor.document.getText(editor.selection);
        if (selectedCode && prompt) {
          chatGptViewProvider?.sendApiRequest(prompt, {
            command,
            code: selectedCode,
            language: editor.document.languageId,
          });
        }
      }),
    );

  context.subscriptions.push(
    webviewViewProvider,
    freeTextCommand,
    clearConversationCommand,
    exportConversationCommand,
    clearSessionCommand,
    configChanged,
    adhocCommand,
    generateCodeCommand,
    ...registeredCommands,
  );

  const setContext = () => {
    menuCommands.forEach((command) => {
      if (command === 'generateCode') {
        let generateCodeEnabled = vscode.workspace
          .getConfiguration('chatgpt')
          .get<boolean>('gpt3.generateCode-enabled');
        const modelName =
          vscode.workspace.getConfiguration('chatgpt').get<string>('gpt3.model') || '';
        const method = vscode.workspace.getConfiguration('chatgpt').get<string>('method') || '';
        generateCodeEnabled =
          generateCodeEnabled && method === 'GPT3 OpenAI API Key' && modelName.startsWith('code-');
        vscode.commands.executeCommand('setContext', 'generateCode-enabled', generateCodeEnabled);
      } else {
        const enabled = !!vscode.workspace
          .getConfiguration('chatgpt.promptPrefix')
          .get<boolean>(`${command}-enabled`);
        vscode.commands.executeCommand('setContext', `${command}-enabled`, enabled);
      }
    });
  };

  setContext();
}

export function deactivate() {}
