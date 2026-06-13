import delay from 'delay';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { OpenAIService } from './openai-service';
import { configManager } from './config';
import { ConversationStore } from './conversation-store';
import { i18n } from './i18n';
// import { OnDidReceiveMessageOptions, SendApiRequestOption, WebviewMessageOptions } from './types';

export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;
  private openaiService?: OpenAIService;
  private questionCount: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  private currentConversationId: string = '';
  private currentMessageId: string = '';
  private response: string = '';
  private pendingWebviewMessage: WebviewMessageOptions | null = null;
  private conversationStore: ConversationStore;

  constructor(private context: vscode.ExtensionContext) {
    this.conversationStore = new ConversationStore(context);
    this.initConfig();
  }

  private webviewViewOnDidReceiveMessage(webviewView: vscode.WebviewView): void {
    webviewView.webview.onDidReceiveMessage(async (data: OnDidReceiveMessageOptions) => {
      switch (data.type) {
        case 'add-question':
          const question = data.value || '';
          // 如果前端附带了附加文件内容，使用 option.code 传递给 sendApiRequest
          // 这样既能通过 buildQuestion 拼接到发送给 API 的数据中，又不会在用户的气泡里显示一大坨代码
          if (data.attachedContent) {
            this.sendApiRequest(question, {
              command: 'freeText',
              code: data.attachedContent,
              language: data.attachedLanguage || '',
            });
          } else {
            this.sendApiRequest(question, { command: 'freeText' });
          }
          break;
        case 'insert-code':
          const code = data.value || '';
          const escapedString = code.replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));
          break;
        case 'open-newtab':
          const document = await vscode.workspace.openTextDocument({
            content: data.value,
            language: data.language,
          });
          vscode.window.showTextDocument(document);
          break;
        case 'clear-conversation':
          this.openaiService?.clearSession();
          this.currentConversationId = '';
          break;
        case 'open-settings':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin chatgpt.',
          );
          break;
        case 'update-key':
          this.showUpdateApiKeyInput();
          break;
        case 'open-prompt-settings':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin promptPrefix',
          );
          break;
        case 'stop-generating':
          this.stopGenerating();
          break;
        case 'load-history':
          this.sendHistoryList();
          break;
        case 'load-conversation':
          await this.loadConversation(data.value || '');
          break;
        case 'delete-conversation':
          await this.deleteConversation(data.value || '');
          break;
        case 'get-current-file':
          this.handleGetCurrentFile();
          break;
        default:
          break;
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.webView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
    this.webviewViewOnDidReceiveMessage(webviewView);

    // WebView 就绪后发送历史列表
    this.sendHistoryList();
  }

  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.inProgress = false;
    this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    this.sendMessageToWebview({
      type: 'add-answer',
      value: this.response,
      done: true,
      id: this.currentMessageId,
      autoScroll: configManager.autoScroll,
    });
  }

  /** 读取当前活动编辑器文件信息并回传给前端 */
  private handleGetCurrentFile(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.sendMessageToWebview({
        type: 'current-file-data',
        filename: '',
        language: '',
        content: '',
      });
      return;
    }
    const document = editor.document;
    const fullContent = document.getText();
    const MAX_FILE_CHARS = 50000;
    const truncated = fullContent.length > MAX_FILE_CHARS;
    this.sendMessageToWebview({
      type: 'current-file-data',
      filename: path.basename(document.fileName),
      language: document.languageId,
      content: truncated ? fullContent.slice(0, MAX_FILE_CHARS) : fullContent,
      truncated,
    });
  }

  public clearSession(): void {
    this.stopGenerating();
    this.openaiService?.clearSession();
    this.openaiService = undefined;
    this.conversationStore.clearAll();
    // 同时清理前端聊天显示（旧消息不再残留）
    this.sendMessageToWebview({ type: 'clear-conversation' }, true);
    this.sendMessageToWebview({ type: 'load-history', history: [] }, true);
  }

  public async initConfig(gptConfigChanged?: boolean): Promise<boolean> {
    const hasApiKey = await this.checkAPIExistence();
    if (!hasApiKey) {
      return false;
    }
    if (!this.openaiService || gptConfigChanged) {
      return await this.initChatGPTModel();
    } else {
      return true;
    }
  }

  private async checkAPIExistence(): Promise<boolean> {
    if (!configManager.apiKey) {
      return await this.promptApiKey();
    } else {
      return true;
    }
  }

  private async initChatGPTModel(): Promise<boolean> {
    this.openaiService = new OpenAIService();
    return true;
  }

  private async promptApiKey(): Promise<boolean> {
    const noApiKeyMessage = i18n.t('chatgpt.pageMessage.noApiKey.message');
    const noApiKeyChoose1 = i18n.t('chatgpt.pageMessage.noApiKey.choose1');
    const noApiKeyChoose2 = i18n.t('chatgpt.pageMessage.noApiKey.choose2');
    const choice = await vscode.window.showErrorMessage(
      noApiKeyMessage,
      noApiKeyChoose1,
      noApiKeyChoose2,
    );
    if (choice === noApiKeyChoose1) {
      const apiKeyValue = await this.showNoApiKeyInput();
      if (apiKeyValue?.trim()) {
        await configManager.setApiKey(apiKeyValue.trim());
        return true;
      } else {
        return false;
      }
    } else if (choice === noApiKeyChoose2) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'chatgpt.gpt.apiKey');
      return false;
    } else {
      return false;
    }
  }

  private async showNoApiKeyInput(apikey?: string): Promise<string> {
    const noApiKeyInputTitle = i18n.t('chatgpt.pageMessage.noApiKey.inputBox.title');
    const noApiKeyInputPrompt = i18n.t('chatgpt.pageMessage.noApiKey.inputBox.prompt');
    const noApiKeyInputPlaceHolder = i18n.t('chatgpt.pageMessage.noApiKey.inputBox.placeHolder');
    apikey = apikey || '';
    const newApiKey = await vscode.window.showInputBox({
      title: noApiKeyInputTitle,
      prompt: noApiKeyInputPrompt,
      ignoreFocusOut: true,
      value: apikey,
      placeHolder: noApiKeyInputPlaceHolder,
    });
    return newApiKey || '';
  }

  private async showUpdateApiKeyInput(): Promise<void> {
    const updateApiKeyInputTitle = i18n.t('chatgpt.pageMessage.updateApiKey.inputBox.title');
    const updateApiKeyInputPrompt = i18n.t('chatgpt.pageMessage.updateApiKey.inputBox.prompt');
    const updateApiKeyInputPlaceHolder = i18n.t(
      'chatgpt.pageMessage.updateApiKey.inputBox.placeHolder',
    );
    const newApiKey = await vscode.window.showInputBox({
      title: updateApiKeyInputTitle,
      prompt: updateApiKeyInputPrompt,
      ignoreFocusOut: true,
      value: configManager.apiKey,
      placeHolder: updateApiKeyInputPlaceHolder,
    });
    if (newApiKey?.trim()) {
      await configManager.setApiKey(newApiKey.trim());
    }
  }

  private buildQuestion(
    question: string,
    code?: string,
    language?: string,
    fileName?: string,
  ): string {
    if (!!code) {
      const contextParts: string[] = [];
      if (language) {
        contextParts.push(`language: ${language}`);
      }
      if (fileName) {
        contextParts.push(`file: ${fileName}`);
      }
      const contextPrefix = contextParts.length > 0 ? `[${contextParts.join(', ')}] ` : '';
      question = `${question}\n\n${contextPrefix}\`\`\`${language || ''}\n${code}\n\`\`\``;
    }
    return question;
  }

  private async showWebview(): Promise<void> {
    if (this.webView === undefined) {
      await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
      await delay(250);
      if (this.pendingWebviewMessage !== null) {
        this.sendMessageToWebview(this.pendingWebviewMessage);
        this.pendingWebviewMessage = null;
      }
    } else {
      await this.webView?.show?.(true);
    }
  }

  private createAbortController(): void {
    this.abortController = new AbortController();
  }

  private processPreviousAnswer(option: SendApiRequestOption): void {
    if (!!option.previousAnswer) {
      this.response = option.previousAnswer + this.response;
    }
  }

  private async checkForContinuation(option: SendApiRequestOption): Promise<void> {
    const hasContinuation = this.response.split('```').length % 2 === 0;
    if (hasContinuation) {
      this.response = this.response + ' \r\n ```\r\n';
      const dontCompleteMessage = i18n.t('chatgpt.pageMessage.dontComplete.message');
      const dontCompleteChoose = i18n.t('chatgpt.pageMessage.dontComplete.choose');
      const choice = await vscode.window.showInformationMessage(
        dontCompleteMessage,
        dontCompleteChoose,
      );
      if (choice === dontCompleteChoose) {
        const prompt = i18n.t('chatgpt.pageMessage.dontComplete.prompt');
        this.sendApiRequest(prompt, {
          command: option.command,
          code: undefined,
          previousAnswer: this.response,
        });
      }
    }
  }

  private async subscribeResponseDialog(): Promise<void> {
    if (configManager.subscribeToResponse) {
      const subscribeToResponseMessage = i18n.t('chatgpt.pageMessage.subscribeToResponse.message');
      const subscribeToResponseChoose = i18n.t('chatgpt.pageMessage.subscribeToResponse.choose');

      vscode.window
        .showInformationMessage(subscribeToResponseMessage, subscribeToResponseChoose)
        .then(async () => {
          await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
        });
    }
  }

  public async sendApiRequest(prompt: string, option: SendApiRequestOption): Promise<void> {
    if (this.inProgress) {
      return;
    }
    this.questionCount++;
    this.currentMessageId = this.getRandomId();

    if (!(await this.initConfig())) {
      return;
    }
    this.response = '';

    const question = this.buildQuestion(prompt, option.code, option.language, option.fileName);
    await this.showWebview();
    this.inProgress = true;
    this.createAbortController();
    this.sendMessageToWebview({
      type: 'show-in-progress',
      inProgress: this.inProgress,
      showStopButton: true,
    });
    // 如果是新对话，分配一个对话 ID；否则沿用当前对话 ID
    if (!this.currentConversationId) {
      this.currentConversationId = this.getRandomId();
    }
    this.sendMessageToWebview({
      type: 'add-question',
      value: prompt,
      code: option.code,
      autoScroll: configManager.autoScroll,
    });

    try {
      if (this.openaiService) {
        this.response = await this.openaiService.sendMessage(question, {
          systemMessage: configManager.systemMessage,
          abortSignal: this.abortController?.signal,
          onProgress: (text) => {
            this.response = text;
            this.sendMessageToWebview({
              type: 'add-answer',
              value: this.response,
              id: this.currentMessageId,
              autoScroll: configManager.autoScroll,
            });
          },
        });
      }
      await this.processPreviousAnswer(option);
      this.checkForContinuation(option);
      this.sendMessageToWebview({
        type: 'add-answer',
        value: this.response,
        done: true,
        id: this.currentMessageId,
        autoScroll: configManager.autoScroll,
      });
      // 保存对话到历史
      await this.saveCurrentConversation();
      this.sendHistoryList();
      await this.subscribeResponseDialog();
    } catch (error: any) {
      const statusCode = error?.status || error?.statusCode || 'Error';
      const msg = error?.message || String(error);
      this.sendMessageToWebview({
        type: 'add-error',
        value: `[${statusCode}] ${msg}`,
        autoScroll: configManager.autoScroll,
      });
      return;
    } finally {
      this.inProgress = false;
      this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    }
  }

  /** 发送历史列表到前端 */
  private sendHistoryList(): void {
    const all = this.conversationStore.getAll();
    const history = all.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
    }));
    this.sendMessageToWebview({ type: 'load-history', history });
  }

  /** 加载指定历史对话 */
  private async loadConversation(id: string): Promise<void> {
    const conversation = this.conversationStore.getById(id);
    if (!conversation) {
      return;
    }

    // 重建 OpenAI service 并加载上下文
    if (!(await this.initConfig())) {
      return;
    }
    this.openaiService?.clearSession();
    this.openaiService?.loadConversation(conversation.messages, configManager.systemMessage);
    this.currentConversationId = id;

    // 告诉前端渲染这些消息
    this.sendMessageToWebview({
      type: 'load-conversation',
      conversationId: id,
      messages: conversation.messages,
    });
  }

  /** 删除指定历史对话 */
  private async deleteConversation(id: string): Promise<void> {
    await this.conversationStore.delete(id);
    // 如果删除的是当前对话，清空显示
    if (id === this.currentConversationId) {
      this.openaiService?.clearSession();
      this.currentConversationId = '';
      this.sendMessageToWebview({ type: 'clear-conversation' });
    }
    this.sendHistoryList();
  }

  /** 保存当前对话到历史 */
  private async saveCurrentConversation(): Promise<void> {
    if (!this.openaiService || !this.currentConversationId) {
      return;
    }
    const messages = this.openaiService.getConversationMessages();
    if (messages.length === 0) {
      return;
    }

    // 获取已有对话以保留标题
    const existing = this.conversationStore.getById(this.currentConversationId);

    await this.conversationStore.save({
      id: this.currentConversationId,
      title: existing?.title || '',
      createdAt: existing?.createdAt || Date.now(),
      messages,
    });
  }

  public sendMessageToWebview(
    webviewMessage: WebviewMessageOptions,
    ignoreMessageIfNullWebView?: boolean,
  ): void {
    if (this.webView) {
      this.webView?.webview.postMessage(webviewMessage);
    } else if (!ignoreMessageIfNullWebView) {
      this.pendingWebviewMessage = webviewMessage;
    }
  }

  private getWebviewHtml(webview?: vscode.Webview): string {
    const reg = /\{{([\w.]+)}}/g;
    const webviewHtmlPath = path.join(this.context.extensionPath, 'media', 'web-view.html');
    const webViewScriptPatch = path.join(this.context.extensionPath, 'media', 'web-view.js');
    let html = fs.readFileSync(webviewHtmlPath, 'utf-8');
    let script = fs.readFileSync(webViewScriptPatch, 'utf-8');

    const documentPath = path.dirname(webviewHtmlPath);
    html = html.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (_m, $1, $2) => {
      return `${$1}${this.webView?.webview.asWebviewUri(
        vscode.Uri.file(path.resolve(documentPath, $2)),
      )}"`;
    });
    html = html.replace(reg, (_match, matchedValue) => {
      return i18n.t(matchedValue);
    });
    script = script.replace(reg, (_match, matchedValue) => {
      return i18n.t(matchedValue);
    });
    html = html.replace(
      /<script nonce="nonce">(.*)<\/script>/,
      `<script nonce=${this.getRandomId()}>${script}</script>`,
    );
    return html;
  }

  private getRandomId(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
