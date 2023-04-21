import * as vscode from 'vscode';
import ChatgptViewProvider from './chatgpt-view-provider';
const defaultLocale = 'zh';
const menuCommands = [
  'addTests',
  'findProblems',
  'optimize',
  'explain',
  'addComments',
  'completeCode',
  'generateCode',
  'customPrompt1',
  'customPrompt2',
  'adhoc',
];
const locales = {
  [defaultLocale]: require('../i18n/zh-cn.json'),
  en: require('../i18n/en.json'),
};

let currentLocale = defaultLocale;
export async function activate(context: vscode.ExtensionContext) {
  // console.log(`${locales.zh['vscode-chatgpt.freeText.title']} `);
  // 获取本地化信息
  const locale = vscode.env.language;
  console.log('locale', locale);
  // 注册webview
  const chatGptViewProvider = new ChatgptViewProvider(context);

  const webviewViewProvider = vscode.window.registerWebviewViewProvider(
    'vscode-chatgpt.view',
    chatGptViewProvider,
    {
      webviewOptions: {
        // webview被隐藏时保持状态，避免被重置
        retainContextWhenHidden: true,
      },
    },
  );
  // 注册 freeText 命令
  const freeText = vscode.commands.registerCommand('vscode-chatgpt.freeText', async () => {
    const value = await vscode.window.showInputBox({
      prompt: 'Ask anything...',
    });

    if (value) {
      chatGptViewProvider?.sendApiRequest(value, { command: 'freeText' });
    }
  });
  // 注册 clearConversation 命令
  const resetThread = vscode.commands.registerCommand(
    'vscode-chatgpt.clearConversation',
    async () => {
      chatGptViewProvider?.sendMessage({ type: 'clearConversation' }, true);
    },
  );
  // 注册 exportConversation 命令
  const exportConversation = vscode.commands.registerCommand(
    'vscode-chatgpt.exportConversation',
    async () => {
      chatGptViewProvider?.sendMessage({ type: 'exportConversation' }, true);
    },
  );
  // 注册 clearSession 命令
  const clearSession = vscode.commands.registerCommand('vscode-chatgpt.clearSession', () => {
    context.globalState.update('chatgpt-session-token', null);
    context.globalState.update('chatgpt-clearance-token', null);
    context.globalState.update('chatgpt-user-agent', null);
    context.globalState.update('chatgpt-gpt3-apiKey', null);
    chatGptViewProvider?.clearSession();
  });

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

  let adhocCommandPrefix: string = context.globalState.get('chatgpt-adhoc-prompt') || '';
  // 注册 adhoc 命令
  const adhocCommand = vscode.commands.registerCommand('vscode-chatgpt.adhoc', async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return;
    }

    const selection = editor.document.getText(editor.selection);
    let dismissed = false;
    if (selection) {
      await vscode.window
        .showInputBox({
          title: 'Add prefix to your ad-hoc command',
          prompt: 'Prefix your code with your custom prompt. i.e. Explain this',
          ignoreFocusOut: true,
          placeHolder: 'Ask anything...',
          value: adhocCommandPrefix,
        })
        .then((value) => {
          if (!value) {
            dismissed = true;
            return;
          }

          adhocCommandPrefix = value.trim() || '';
          context.globalState.update('chatgpt-adhoc-prompt', adhocCommandPrefix);
        });

      if (!dismissed && adhocCommandPrefix?.length > 0) {
        chatGptViewProvider?.sendApiRequest(adhocCommandPrefix, {
          command: 'adhoc',
          code: selection,
        });
      }
    }
  });
  // 注册 generateCode 命令
  const generateCodeCommand = vscode.commands.registerCommand(`vscode-chatgpt.generateCode`, () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const selectionCode = editor.document.getText(editor.selection);
    if (selectionCode) {
      chatGptViewProvider?.sendApiRequest(selectionCode, {
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
        const selectionCode = editor.document.getText(editor.selection);
        if (selectionCode && prompt) {
          chatGptViewProvider?.sendApiRequest(prompt, {
            command,
            code: selectionCode,
            language: editor.document.languageId,
          });
        }
      }),
    );

  context.subscriptions.push(
    webviewViewProvider,
    freeText,
    resetThread,
    exportConversation,
    clearSession,
    configChanged,
    adhocCommand,
    generateCodeCommand,
    ...registeredCommands,
  );

  const setContext = () => {
    menuCommands.forEach((command) => {
      if (command === 'generateCode') {
        let generateCodeEnabled = !!vscode.workspace
          .getConfiguration('chatgpt')
          .get<boolean>('gpt3.generateCode-enabled');
        const modelName = vscode.workspace.getConfiguration('chatgpt').get('gpt3.model') as string;
        const method = vscode.workspace.getConfiguration('chatgpt').get('method') as string;
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
