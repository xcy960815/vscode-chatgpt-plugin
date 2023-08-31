/* eslint-disable @typescript-eslint/naming-convention */
import delay from 'delay';
import fetch from 'isomorphic-fetch';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GptModelAPI } from './gpt-model-api';
import { TextModleAPI } from './text-model-api';
import { OnDidReceiveMessageOptions, SendApiRequestOption, WebviewMessageOptions } from './types';
export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;
  private textModel?: TextModleAPI;
  private gptModel?: GptModelAPI;
  private parentMessageId?: string;
  private questionCount: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  // 当前会话的id
  private currentConversationId: string = '';
  private response: string = '';
  private WebviewMessageOptions: WebviewMessageOptions | null = null;
  public language: Record<string, string> = {};
  /**
   * 如果消息没有被渲染，则延迟渲染
   * 在调用 resolveWebviewView 之前的时间。
   */
  constructor(private context: vscode.ExtensionContext) {
    this.loadLanguage();
    this.initConfig();
  }
  /**
   * @desc 获取当前语言
   * @returns {void}
   */
  private loadLanguage(): void {
    const language = vscode.env.language;
    if (language === 'zh-cn') {
      const languageFilePath = path.join(
        this.context.extensionPath,
        './',
        'package.nls.zh-cn.json',
      );
      const json = fs.readFileSync(languageFilePath, 'utf-8');
      this.language = JSON.parse(json);
    } else {
      const languageFilePath = path.join(this.context.extensionPath, './', 'package.nls.json');
      const json = fs.readFileSync(languageFilePath, 'utf-8');
      this.language = JSON.parse(json);
    }
  }
  private get chatGptConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatgpt');
  }
  /**
   * @desc chatgpt模型是否是 "gpt-3.5-turbo","gpt-3.5-turbo-0613","gpt-4"
   * @returns {boolean}
   */
  private get isGptModel(): boolean {
    return !!this.model?.startsWith('gpt-');
  }
  /**
   * @desc chatgpt模型是否是 "text-davinci-003, text-babbage-001, text-ada-001"
   * @returns {boolean}
   */
  private get isTextModel(): boolean {
    return !!this.model?.startsWith('text-');
  }
  /**
   * @desc 回答问题是否自动滚动到底部
   * @returns {boolean}
   */
  private get autoScroll(): boolean {
    return this.chatGptConfig.get<boolean>('response.autoScroll') || false;
  }
  /**
   * @desc 是否订阅回答
   * @returns {boolean}
   */
  private get subscribeToResponse(): boolean {
    return this.chatGptConfig.get<boolean>('response.subscribeToResponse') || false;
  }
  /**
   * @desc gpt 模型
   * @returns {string}
   */
  private get model(): string {
    return this.chatGptConfig.get<string>('gpt.model') || '';
  }
  /**
   * @desc gpt organization 参数
   * @returns {string}
   */
  private get organization(): string {
    return this.chatGptConfig.get<string>('gpt.organization') || '';
  }
  /**
   * @desc gpt max_tokens 参数
   * @returns {number}
   */
  private get max_tokens(): number {
    return this.chatGptConfig.get<number>('gpt.maxTokens') || 2048;
  }
  /**
   * @desc gpt temperature 参数
   * @returns {number}
   */
  private get temperature(): number {
    return this.chatGptConfig.get<number>('gpt.temperature') || 0.9;
  }
  /**
   * @desc gpt top_p 参数
   * @returns {number}
   */
  private get top_p(): number {
    return this.chatGptConfig.get<number>('gpt.top_p') || 1;
  }

  private get withContent(): boolean {
    return this.chatGptConfig.get<boolean>('gpt.withContent') || false;
  }
  /**
   * @desc gpt apiBaseUrl 参数
   * @returns {string}
   */
  private get apiBaseUrl(): string {
    return this.chatGptConfig.get<string>('gpt.apiBaseUrl')?.trim() || '';
  }
  /**
   * @desc gpt apiKey 参数
   * @returns {string}
   */
  private get apiKey(): string {
    const globalState = this.context.globalState;
    const apiKey =
      globalState.get<string>('chatgpt-gpt-apiKey') ||
      this.chatGptConfig.get<string>('gpt.apiKey') ||
      '';
    return apiKey;
  }
  /**
   * @desc 给chatgpt的系统信息
   * @returns {string}
   */
  private get systemMessage(): string {
    return this.chatGptConfig.get<string>('gpt.systemMessage') || '';
  }

  private webviewViewOnDidReceiveMessage(webviewView: vscode.WebviewView): void {
    // 在监听器内部根据消息命令类型执行不同的操作。
    webviewView.webview.onDidReceiveMessage(async (data: OnDidReceiveMessageOptions) => {
      switch (data.type) {
        case 'add-question':
          const question = data.value || '';
          this.sendApiRequest(question, { command: 'freeText' });
          break;
        case 'insert-code':
          // 插入代码
          const code = data.value || '';
          const escapedString = code.replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));
          break;
        case 'open-newtab':
          // 打开新的tab页
          const document = await vscode.workspace.openTextDocument({
            content: data.value,
            language: data.language,
          });
          vscode.window.showTextDocument(document);
          break;
        case 'clear-conversation':
          // 清空会话
          this.parentMessageId = undefined;
          this.gptModel?._clearMessage();
          this.textModel?._clearMessage();
          break;
        case 'open-settings':
          // 打开设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin chatgpt.',
          );
          break;
        case 'update-key':
          // 更新apikey
          this.showUpdateApiKeyInput();
          break;
        case 'open-prompt-settings':
          // 打开话术前缀设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:xcy960815.vscode-chatgpt-plugin promptPrefix',
          );
          break;
        case 'stop-generating':
          // 停止生成代码
          this.stopGenerating();
          break;
        default:
          break;
      }
    });
  }
  /**
   * @desc 加载webview
   * @param {vscode.WebviewView} webviewView
   * @param {vscode.WebviewViewResolveContext} _context
   * @param {vscode.CancellationToken} _token
   */
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
    // 设置webview的html内容
    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
    this.webviewViewOnDidReceiveMessage(webviewView);
  }
  /**
   * @desc 终止生成代码
   * @returns {void}
   */
  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.setInProgressStatus(false);
    this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    this.sendMessageToWebview({
      type: 'add-answer',
      value: this.response,
      done: true,
      id: this.currentConversationId,
      autoScroll: this.autoScroll,
    });
  }
  /**
   * @desc 清空会话
   * @returns {void}
   */
  public clearSession(): void {
    this.stopGenerating();
    this.textModel?._clearMessage();
    this.textModel = undefined;
    this.gptModel?._clearMessage();
    this.gptModel = undefined;
    this.parentMessageId = undefined;
  }
  /**
   * @desc 初始化会话
   * @returns {Promise<boolean>}
   */
  public async initConfig(gptConfigChanged?: boolean): Promise<boolean> {
    const hasApiKey = await this.checkAPIExistence();
    if (!hasApiKey) {
      return false;
    }
    if (!this.textModel || !this.gptModel || gptConfigChanged) {
      return await this.initChatGPTModel();
    } else {
      return true;
    }
  }
  /**
   * @desc 检查api是否存在
   * @returns {Promise<boolean>}
   */
  private async checkAPIExistence(): Promise<boolean> {
    if (!this.apiKey) {
      return await this.promptApiKey();
    } else {
      return true;
    }
  }
  /**
   * @desc 初始化chatgpt模型
   * @returns {Promise<boolean>}
   */
  private async initChatGPTModel(): Promise<boolean> {
    // 初始化chatgpt模型
    this.gptModel = new GptModelAPI({
      apiKey: this.apiKey,
      fetch: fetch,
      apiBaseUrl: this.apiBaseUrl,
      organization: this.organization,
      withContent: this.withContent,
      CompletionRequestParams: {
        model: this.model,
        max_tokens: this.max_tokens,
        temperature: this.temperature,
        top_p: this.top_p,
      },
    });
    this.textModel = new TextModleAPI({
      apiKey: this.apiKey,
      fetch: fetch,
      apiBaseUrl: this.apiBaseUrl,
      organization: this.organization,
      withContent: this.withContent,
      CompletionRequestParams: {
        model: this.model,
        max_tokens: this.max_tokens,
        temperature: this.temperature,
        top_p: this.top_p,
      },
    });
    return true;
  }
  /**
   * @desc 提示输入apiKey
   * @returns {Promise<boolean>}
   */
  private async promptApiKey(): Promise<boolean> {
    const noApiKeyMessage = this.language['chatgpt.pageMessage.noApiKey.message'];
    const noApiKeyChoose1 = this.language['chatgpt.pageMessage.noApiKey.choose1'];
    const noApiKeyChoose2 = this.language['chatgpt.pageMessage.noApiKey.choose2'];
    const choice = await vscode.window.showErrorMessage(
      noApiKeyMessage,
      noApiKeyChoose1,
      noApiKeyChoose2,
    );
    if (choice === noApiKeyChoose1) {
      const apiKeyValue = await this.showNoApiKeyInput();
      if (apiKeyValue?.trim()) {
        // 全局状态
        const globalState = this.context.globalState;
        // 存储在全局状态中
        globalState.update('chatgpt-gpt-apiKey', apiKeyValue?.trim());
        return true;
      } else {
        return false;
      }
    } else if (choice === noApiKeyChoose2) {
      // 打开关于openai apiKey的设置项
      vscode.commands.executeCommand('workbench.action.openSettings', 'chatgpt.gpt.apiKey');
      return false;
    } else {
      return false;
    }
  }
  /**
   * @desc 展示输入apiKey输入框
   * @param apikey {string}
   * @returns {Promise<string>}
   */
  private async showNoApiKeyInput(apikey?: string): Promise<string> {
    const noApiKeyInputTitle = this.language['chatgpt.pageMessage.noApiKey.inputBox.title'];
    const noApiKeyInputPrompt = this.language['chatgpt.pageMessage.noApiKey.inputBox.prompt'];
    const noApiKeyInputPlaceHolder =
      this.language['chatgpt.pageMessage.noApiKey.inputBox.placeHolder'];
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
  /**
   * @desc 展示更新apiKey输入框
   * @returns {Promise<void>}
   */
  private async showUpdateApiKeyInput(): Promise<void> {
    const updateApiKeyInputTitle = this.language['chatgpt.pageMessage.updateApiKey.inputBox.title'];
    const updateApiKeyInputPrompt =
      this.language['chatgpt.pageMessage.updateApiKey.inputBox.prompt'];
    const updateApiKeyInputPlaceHolder =
      this.language['chatgpt.pageMessage.updateApiKey.inputBox.placeHolder'];
    const globalStateHasKey = this.context.globalState.get<string>('chatgpt-gpt-apiKey');
    const configHasKey = this.chatGptConfig.get<string>('gpt.apiKey');
    const newApiKey = await vscode.window.showInputBox({
      title: updateApiKeyInputTitle,
      prompt: updateApiKeyInputPrompt,
      ignoreFocusOut: true,
      value: this.apiKey,
      placeHolder: updateApiKeyInputPlaceHolder,
    });
    if (newApiKey?.trim()) {
      if (!!globalStateHasKey) {
        // 全局状态
        const globalState = this.context.globalState;
        // 存储在全局状态中
        globalState.update('chatgpt-gpt-apiKey', newApiKey?.trim());
      }
      if (!!configHasKey) {
        // 更新配置
        await vscode.workspace
          .getConfiguration('chatgpt')
          .update('gpt.apiKey', newApiKey?.trim(), vscode.ConfigurationTarget.Global);
      }
    }
  }
  /**
   * @desc 构建消息
   * @param question {string}
   * @param code {string}
   * @param language {string}
   * @returns {string}
   */
  private buildQuestion(question: string, code?: string, language?: string): string {
    if (!!code) {
      // question = `${question}${language ? ` (The following code is in ${language} programming language)` : ''}: ${code}`;
      question = `${question}: ${code}`;
    }
    return question; //+ '\r\n';
  }
  /**
   * @desc 展示webview
   * @returns {Promise<void>}
   */
  private async showWebview(): Promise<void> {
    if (this.webView === undefined) {
      // 通过执行命令打开webview
      await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
      await delay(250);
      if (this.WebviewMessageOptions !== null) {
        this.sendMessageToWebview(this.WebviewMessageOptions);
        this.WebviewMessageOptions = null;
      }
    } else {
      await this.webView?.show?.(true);
    }
  }
  /**
   * @desc 更新 inProgress 状态
   * @param status {boolean}
   * @returns {void}
   */
  private setInProgressStatus(status: boolean): void {
    this.inProgress = status;
  }
  private createAbortController(): void {
    this.abortController = new AbortController();
  }
  private processPreviousAnswer(option: SendApiRequestOption): void {
    if (!!option.previousAnswer) {
      this.response = option.previousAnswer + this.response;
    }
  }
  /**
   * @desc 检查是否回答完毕
   * @param option {SendApiRequestOption}
   * @returns {Promise<boolean>}
   */
  private async checkForContinuation(option: SendApiRequestOption): Promise<void> {
    // 当 max_tokens 不够时，会返回一个提示，需要继续执行
    const hasContinuation = this.response.split('```').length % 2 === 0;
    if (hasContinuation) {
      // 如果需要继续执行，请处理逻辑
      this.response = this.response + ' \r\n ```\r\n';
      const dontCompleteMessage = this.language['chatgpt.pageMessage.dontComplete.message'];
      const dontCompleteChoose = this.language['chatgpt.pageMessage.dontComplete.choose'];
      const choice = await vscode.window.showInformationMessage(
        dontCompleteMessage,
        dontCompleteChoose,
      );
      if (choice === dontCompleteChoose) {
        const prompt = this.language['chatgpt.pageMessage.dontComplete.prompt'];
        this.sendApiRequest(prompt, {
          command: option.command,
          code: undefined,
          previousAnswer: this.response,
        });
      }
    }
  }
  /**
   * @desc 订阅响应对话
   * @returns {Promise<void>}
   */
  private async subscribeResponseDialog(): Promise<void> {
    // 如果打开了订阅对话的配置
    if (this.subscribeToResponse) {
      // 给用户通知
      const subscribeToResponseMessage =
        this.language['chatgpt.pageMessage.subscribeToResponse.message'];

      const subscribeToResponseChoose =
        this.language['chatgpt.pageMessage.subscribeToResponse.choose'];

      vscode.window
        .showInformationMessage(subscribeToResponseMessage, subscribeToResponseChoose)
        .then(async () => {
          // 打开窗口
          await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
        });
    }
  }
  /**
   * @desc 获取错误信息
   * @param {any} error
   * @returns  {string}
   */
  private getErrorMessageFromErrorType(error: any): string {
    switch (error.statusCode) {
      case 400:
        const errorMessage400 = this.language['chatgpt.pageMessage.400.error.message'] || '';
        return errorMessage400.replace('{model}', this.model);
      case 401:
        const errorMessage401 = this.language['chatgpt.pageMessage.401.error.message'] || '';
        return errorMessage401;
      case 403:
        const errorMessage403 = this.language['chatgpt.pageMessage.403.error.message'] || '';
        return errorMessage403;
      case 404:
        const errorMessage404 = this.language['chatgpt.pageMessage.404.error.message'] || '';
        return errorMessage404.replace('{model}', this.model);
      case 429:
        const errorMessage429 = this.language['chatgpt.pageMessage.429.error.message'] || '';
        return errorMessage429;
      case 500:
        const errorMessage500 = this.language['chatgpt.pageMessage.500.error.message'] || '';
        return errorMessage500;
      default:
        return '';
    }
  }
  /**
   * @description 处理错误对话框
   * @param {string} prompt
   * @param {SendApiRequestOption} option
   */
  private async handleErrorDialog(prompt: string, option: SendApiRequestOption): Promise<void> {
    // 从配置中获取错误信息
    const errorMessage = this.language['chatgpt.pageMessage.maxToken.error.message'] || '';
    // 从配置中获取错误选择
    const errorChoose = this.language['chatgpt.pageMessage.maxToken.error.choose'] || '';
    vscode.window.showErrorMessage(errorMessage, errorChoose).then(async (choice) => {
      if (choice === errorChoose) {
        await vscode.commands.executeCommand('vscode-chatgpt.clearConversation');
        await delay(250);
        this.sendApiRequest(prompt, { command: option.command, code: option.code });
      }
    });
  }
  /**
   * @desc 处理错误响应
   * @param {any} error
   * @param {string} prompt
   * @param {SendApiRequestOption} option
   * @returns {void}
   */
  private handleErrorResponse(error: any, prompt: string, option: SendApiRequestOption): void {
    const statusCode = error?.response?.status;
    if ([400, 401, 403, 404, 429, 500].includes(statusCode)) {
      const message = this.getErrorMessageFromErrorType(error);
      const apiErrorMessage =
        error?.response?.data?.error?.message || error?.tostring?.() || error?.message;
      const errorMessage = `${message ? message + ' ' : ''}${
        apiErrorMessage ? apiErrorMessage : ''
      }`;
      this.sendMessageToWebview({
        type: 'add-error',
        value: errorMessage,
        autoScroll: this.autoScroll,
      });
    } else {
      //  上下文超长
      this.handleErrorDialog(prompt, option);
    }
  }

  /**
   * @desc 处理问题并将其发送到 API
   * @param {string} prompt
   * @param {SendApiRequestOption} option
   * @returns
   */
  public async sendApiRequest(prompt: string, option: SendApiRequestOption): Promise<void> {
    if (this.inProgress) {
      return;
    }
    this.questionCount++;

    // 校验是否登录
    if (!(await this.initConfig())) {
      return;
    }
    this.response = '';

    const question = this.buildQuestion(prompt, option.code, option.language);
    await this.showWebview();
    this.setInProgressStatus(true);
    this.createAbortController();
    this.sendMessageToWebview({
      type: 'show-in-progress',
      inProgress: this.inProgress,
      showStopButton: true,
    });
    this.currentConversationId = this.getRandomId();
    // 要始终保持 messageId 的唯一性
    const messageId = this.getRandomId();
    this.sendMessageToWebview({
      type: 'add-question',
      value: prompt,
      code: option.code,
      autoScroll: this.autoScroll,
    });

    try {
      if (this.isGptModel && this.gptModel) {
        const response = await this.gptModel.sendMessage(question, {
          systemMessage: this.systemMessage,
          messageId,
          parentMessageId: this.parentMessageId,
          abortSignal: this.abortController?.signal,
          onProgress: (partialResponse) => {
            this.response = partialResponse.text;
            this.sendMessageToWebview({
              type: 'add-answer',
              value: this.response,
              id: this.currentConversationId,
              autoScroll: this.autoScroll,
            });
          },
        });
        this.response = response.text;
        this.parentMessageId = response.parentMessageId;
      }
      if (this.isTextModel && this.textModel) {
        const response = await this.textModel.sendMessage(question, {
          systemMessage: this.systemMessage,
          abortSignal: this.abortController?.signal,
          messageId,
          parentMessageId: this.parentMessageId,
          onProgress: (partialResponse) => {
            this.response = partialResponse.text;
            this.sendMessageToWebview({
              type: 'add-answer',
              value: this.response,
              id: this.currentConversationId,
              autoScroll: this.autoScroll,
            });
          },
        });
        this.response = response.text;
        this.parentMessageId = response.parentMessageId;
      }
      await this.processPreviousAnswer(option);
      this.checkForContinuation(option);
      // 回答完毕
      this.sendMessageToWebview({
        type: 'add-answer',
        value: this.response,
        done: true,
        id: this.currentConversationId,
        autoScroll: this.autoScroll,
      });
      await this.subscribeResponseDialog();
    } catch (error: any) {
      console.log('error', error);

      // this.handleErrorResponse(error, prompt, option);
      return;
    } finally {
      this.setInProgressStatus(false);
      this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    }
  }
  /**
   * @desc 消息发送器 将消息发送到webview
   * @param {WebviewMessageOptions} WebviewMessageOptions
   * @param {boolean} ignoreMessageIfNullWebView
   * @returns {void}
   */
  public sendMessageToWebview(
    WebviewMessageOptions: WebviewMessageOptions,
    ignoreMessageIfNullWebView?: boolean,
  ): void {
    if (this.webView) {
      this.webView?.webview.postMessage(WebviewMessageOptions);
    } else if (!ignoreMessageIfNullWebView) {
      this.WebviewMessageOptions = WebviewMessageOptions;
    }
  }
  private getWebviewHtml(webview?: vscode.Webview): string {
    const reg = /\{{([\w.]+)}}/g;
    const webviewHtmlPath = path.join(this.context.extensionPath, 'media', 'web-view.html');
    const webViewScriptPatch = path.join(this.context.extensionPath, 'media', 'web-view.js');
    let html = fs.readFileSync(webviewHtmlPath, 'utf-8');
    let script = fs.readFileSync(webViewScriptPatch, 'utf-8');

    const documentPath = path.dirname(webviewHtmlPath);
    //  替换本地静态资源路径
    html = html.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (_m, $1, $2) => {
      return `${$1}${this.webView?.webview.asWebviewUri(
        vscode.Uri.file(path.resolve(documentPath, $2)),
      )}"`;
    });
    // 替换语言
    html = html.replace(reg, (_match, matchedValue) => {
      return this.language[matchedValue] || matchedValue;
    });
    // 替换语言
    script = script.replace(reg, (_match, matchedValue) => {
      return this.language[matchedValue] || matchedValue;
    });
    // 替换脚本
    html = html.replace(
      /<script nonce="nonce">(.*)<\/script>/,
      `<script nonce=${this.getRandomId()}>${script}</script>`,
    );
    return html;
  }
  /**
   * @desc 获取随机字符串
   * @returns {string}
   */
  private getRandomId(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
