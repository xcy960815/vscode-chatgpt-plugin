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
  'adhoc',
  'customPrompt1',
  'customPrompt2',
];

export async function activate(context: vscode.ExtensionContext) {
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

  // 注册对空对话命令
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
    context.globalState.update('chatgpt-session-token', null);
    context.globalState.update('chatgpt-clearance-token', null);
    context.globalState.update('chatgpt-user-agent', null);
    context.globalState.update('chatgpt-gpt3-apiKey', null);
    chatGptViewProvider?.clearSession();
  });

  const vscodeConfigChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    // 关于chatgpt的配置发生变更后重新 init 模型
    if (
      event.affectsConfiguration('chatgpt.gpt3.apiBaseUrl') ||
      event.affectsConfiguration('chatgpt.gpt3.model') ||
      event.affectsConfiguration('chatgpt.gpt3.organization') ||
      event.affectsConfiguration('chatgpt.gpt3.maxTokens') ||
      event.affectsConfiguration('chatgpt.gpt3.temperature') ||
      event.affectsConfiguration('chatgpt.gpt3.top_p')
    ) {
      chatGptViewProvider.prepareConversation();
    }

    if (
      event.affectsConfiguration('chatgpt.promptPrefix') ||
      event.affectsConfiguration('chatgpt.gpt3.generateCode-enabled') ||
      event.affectsConfiguration('chatgpt.gpt3.model')
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
    chatGptViewProvider?.sendApiRequest(chatgptAdhocPrompt, {
      command: 'adhoc',
      code: selectedCode,
    });
  });

  // 注册 generateCode 命令
  const generateCodeCommand = vscode.commands.registerCommand(`vscode-chatgpt.generateCode`, () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const selectedCode = editor.document.getText(editor.selection).trim();
    if (!selectedCode) {
      return;
    }
    chatGptViewProvider?.sendApiRequest(selectedCode, {
      command: 'generateCode',
      language: editor.document.languageId,
    });
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
    vscodeConfigChanged,
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
        generateCodeEnabled = generateCodeEnabled && modelName.startsWith('code-');
        vscode.commands.executeCommand('setContext', 'generateCode-enabled', generateCodeEnabled);
      } else {
        const enabled =
          vscode.workspace
            .getConfiguration('chatgpt.promptPrefix')
            .get<boolean>(`${command}-enabled`) || false;
        vscode.commands.executeCommand('setContext', `${command}-enabled`, enabled);
      }
    });
  };

  setContext();
}

export function deactivate() {}
