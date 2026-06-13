import * as path from 'node:path';
import * as vscode from 'vscode';
import ChatgptViewProvider from './chatgpt-view-provider';
import { configManager } from './config';
import { i18n } from './i18n';

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

export function registerCommands(
  context: vscode.ExtensionContext,
  chatGptViewProvider: ChatgptViewProvider,
) {
  // 注册 freeText 命令
  const freeTextCommand = vscode.commands.registerCommand('vscode-chatgpt.freeText', async () => {
    const inputBoxPrompt = i18n.t('chatgpt.pageMessage.askAnything.inputBox.prompt');
    const question = await vscode.window.showInputBox({
      prompt: inputBoxPrompt,
    });
    if (question) {
      chatGptViewProvider?.sendApiRequest(question, { command: 'freeText' });
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
    configManager.clearApiKey();
    chatGptViewProvider?.clearSession();
  });

  // 自定义指令1 vscode-chatgpt.customPrompt1
  const customPrompt1Command = vscode.commands.registerCommand(
    'vscode-chatgpt.customPrompt1',
    async () => {
      const activeTextEditor = vscode.window.activeTextEditor;
      if (!activeTextEditor) {
        return;
      }
      const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
      if (!selectedCode) {
        return;
      }
      let customPrompt1 = configManager.getPromptPrefix('customPrompt1');
      if (!customPrompt1) {
        const title = i18n.t('chatgpt.pageMessage.customCommand1.inputBox.title');
        const prompt = i18n.t('chatgpt.pageMessage.customCommand1.inputBox.prompt');
        const placeHolder = i18n.t('chatgpt.pageMessage.customCommand1.inputBox.placeholder');
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
        await configManager.setPromptPrefix('customPrompt1', customPrompt1);
      }
      chatGptViewProvider?.sendApiRequest(customPrompt1, {
        command: 'customPrompt1',
        code: selectedCode,
        language: activeTextEditor.document.languageId,
        fileName: path.basename(activeTextEditor.document.fileName),
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
      const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
      if (!selectedCode) {
        return;
      }
      let customPrompt2 = configManager.getPromptPrefix('customPrompt2');
      if (!customPrompt2) {
        const title = i18n.t('chatgpt.pageMessage.customCommand2.inputBox.title');
        const prompt = i18n.t('chatgpt.pageMessage.customCommand2.inputBox.prompt');
        const placeHolder = i18n.t('chatgpt.pageMessage.customCommand2.inputBox.placeholder');

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
        await configManager.setPromptPrefix('customPrompt2', customPrompt2);
      }
      chatGptViewProvider?.sendApiRequest(customPrompt2, {
        command: 'customPrompt2',
        code: selectedCode,
        language: activeTextEditor.document.languageId,
        fileName: path.basename(activeTextEditor.document.fileName),
      });
    },
  );

  // 注册 添加临时指令
  const adhocCommand = vscode.commands.registerCommand('vscode-chatgpt.adhoc', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const selectedCode = editor.document.getText(editor.selection).trim();
    if (!selectedCode) {
      return;
    }

    const title = i18n.t('chatgpt.pageMessage.adhocCommand.inputBox.title');
    const prompt = i18n.t('chatgpt.pageMessage.adhocCommand.inputBox.prompt');
    const placeHolder = i18n.t('chatgpt.pageMessage.adhocCommand.inputBox.placeholder');

    let adhocPrompt = await vscode.window.showInputBox({
      title,
      prompt,
      ignoreFocusOut: true,
      placeHolder,
      value: configManager.adhocPrompt,
    });
    adhocPrompt = adhocPrompt?.trim();

    if (!adhocPrompt) {
      return;
    }
    configManager.setAdhocPrompt(adhocPrompt);
    chatGptViewProvider?.sendApiRequest(adhocPrompt, {
      command: 'adhoc',
      code: selectedCode,
      language: editor.document.languageId,
      fileName: path.basename(editor.document.fileName),
    });
  });

  // 注册 Ask with Selection 命令
  const askSelectionCommand = vscode.commands.registerCommand(
    'vscode-chatgpt.askSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return;
      }
      const selectedText = editor.document.getText(editor.selection);
      const language = editor.document.languageId;
      const fileName = path.basename(editor.document.fileName);

      // 唤起 Webview 面板
      await chatGptViewProvider.showWebview();
      // 将选中代码作为附件 Chip 发送到前端
      chatGptViewProvider.attachSelection(selectedText, language, fileName, true);
    },
  );

  // 注册菜单命令
  const registeredCommands = menuCommands
    .filter((command) => !['adhoc', 'customPrompt1', 'customPrompt2'].includes(command))
    .map((command) =>
      vscode.commands.registerCommand(`vscode-chatgpt.${command}`, () => {
        const prompt = configManager.getPromptPrefix(command);
        const activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor) {
          const selectedCode = activeTextEditor.document.getText(activeTextEditor.selection).trim();
          if (selectedCode && prompt) {
            chatGptViewProvider?.sendApiRequest(prompt, {
              command,
              code: selectedCode,
              language: activeTextEditor.document.languageId,
              fileName: path.basename(activeTextEditor.document.fileName),
            });
          }
        }
      }),
    );

  context.subscriptions.push(
    freeTextCommand,
    clearConversationCommand,
    exportConversationCommand,
    clearSessionCommand,
    askSelectionCommand,
    adhocCommand,
    customPrompt1Command,
    customPrompt2Command,
    ...registeredCommands,
  );
}

export function setRightMenu() {
  menuCommands.forEach((command) => {
    const commandEnabled = configManager.getPromptPrefixEnabled(command);
    vscode.commands.executeCommand('setContext', `${command}-enabled`, commandEnabled);
  });
}
