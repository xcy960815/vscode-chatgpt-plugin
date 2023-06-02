/* eslint-disable @typescript-eslint/naming-convention */
import delay from 'delay';
import fetch from 'isomorphic-fetch';
import * as vscode from 'vscode';
import { ChatGPTAPI as ChatGPTAPI3 } from './chatgpt-4.7.2';
import { ChatGPTAPI as ChatGPTAPI35 } from './chatgpt-5.1.1';
import { OnDidReceiveMessageOption, SendApiRequestOption, WebviewMessageOption } from './types';
export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;
  private chatgpt3Model?: ChatGPTAPI3;
  private chatgpt35Model?: ChatGPTAPI35;
  private messageId?: string;
  private parentMessageId?: string;
  private questionCount: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  // 当前会话的id
  private currentConversationId: string = '';
  private response: string = '';
  private webviewMessageOption: WebviewMessageOption | null = null;
  /**
   * 如果消息没有被渲染，则延迟渲染
   * 在调用 resolveWebviewView 之前的时间。
   */
  constructor(private context: vscode.ExtensionContext) {
    // this.clearSession();
  }
  private get chatGptConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatgpt');
  }
  /**
   * @desc chatgpt模型是否是 "gpt-3.5-turbo","gpt-3.5-turbo-0301","gpt-4"
   * @returns {boolean}
   */
  private get isGpt35Model(): boolean {
    return !!this.model?.startsWith('gpt-');
  }

  private get autoScroll(): boolean {
    return this.chatGptConfig.get<boolean>('response.autoScroll') || false;
  }

  private get subscribeToResponse(): boolean {
    return this.chatGptConfig.get<boolean>('response.subscribeToResponse') || false;
  }

  private get model(): string {
    const model = this.chatGptConfig.get<string>('gpt3.model') || '';
    return model;
  }
  private get organization(): string {
    return this.chatGptConfig.get<string>('gpt3.organization') || '';
  }

  private get max_tokens(): number {
    return this.chatGptConfig.get<number>('gpt3.maxTokens') || 2048;
  }

  private get temperature(): number {
    return this.chatGptConfig.get<number>('gpt3.temperature') || 0.9;
  }

  private get top_p(): number {
    return this.chatGptConfig.get<number>('gpt3.top_p') || 1;
  }

  private get apiBaseUrl(): string {
    return this.chatGptConfig.get<string>('gpt3.apiBaseUrl')?.trim() || '';
  }

  private get apiKey(): string {
    const globalState = this.context.globalState;
    const apiKey =
      this.chatGptConfig.get<string>('gpt3.apiKey') ||
      globalState.get<string>('chatgpt-gpt3-apiKey') ||
      '';
    return apiKey;
  }
  /**
   * @desc 给chatgpt的系统信息
   * @returns {string}
   */
  private get systemMessage(): string {
    return this.chatGptConfig.get<string>('gpt3.systemMessage') || '';
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

    // 在监听器内部根据消息命令类型执行不同的操作。
    webviewView.webview.onDidReceiveMessage(async (data: OnDidReceiveMessageOption) => {
      switch (data.type) {
        case 'add-question':
          this.sendApiRequest(data.value as string, { command: 'freeText' });
          break;
        case 'insert-code':
          const escapedString = (data.value as string).replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));

          break;
        case 'open-new-tab':
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
          this.messageId = undefined;
          break;
        case 'clear-gpt3':
          this.chatgpt3Model = undefined;
          break;
        case 'login':
          const loginStatus = await this.prepareConversation();
          if (loginStatus) {
            this.sendMessageToWebview({ type: 'login-successful', showConversations: false }, true);
          }
          break;
        case 'open-settings':
          // 打开设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt-plugin chatgpt.',
          );
          break;
        case 'open-prompt-settings':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt-plugin promptPrefix',
          );
          break;
        case 'show-conversations':
          // 显示对话
          break;
        case 'show-conversation':
          break;
        case 'stop-generating':
          // 停止生成代码
          this.stopGenerating();
          break;
        case 'get-chatgpt-config':
          this.sendMessageToWebview(
            {
              type: 'set-chatgpt-config',
              value: this.chatGptConfig,
            },
            true,
          );
          break;
        default:
          break;
      }
    });
  }
  /**
   * @desc 终止生成代码
   * @returns {void}
   */
  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.inProgress = false;
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
    this.chatgpt3Model = undefined;
    this.parentMessageId = undefined;
    this.messageId = undefined;
  }
  /**
   * @desc 会话前准备
   * @returns {Promise<boolean>}
   */
  public async prepareConversation(): Promise<boolean> {
    const hasApiKey = await this.checkAPIExistence();
    if (!hasApiKey) {
      return false;
    }
    if (!this.chatgpt3Model && !this.chatgpt35Model) {
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
    if (this.isGpt35Model) {
      this.chatgpt35Model = new ChatGPTAPI35({
        apiKey: this.apiKey,
        fetch: fetch,
        apiBaseUrl: this.apiBaseUrl,
        organization: this.organization,
        completionParams: {
          model: this.model,
          max_tokens: this.max_tokens,
          temperature: this.temperature,
          top_p: this.top_p,
        },
      });
    } else {
      this.chatgpt3Model = new ChatGPTAPI3({
        apiKey: this.apiKey,
        fetch: fetch,
        apiBaseUrl: this.apiBaseUrl,
        organization: this.organization,
        completionParams: {
          model: this.model,
          max_tokens: this.max_tokens,
          temperature: this.temperature,
          top_p: this.top_p,
        },
      });
    }
    // 登录成功
    this.sendMessageToWebview({ type: 'login-successful', showConversations: false }, true);
    return true;
  }
  /**
   * @desc 提示输入apiKey
   * @returns {Promise<boolean>}
   */
  private async promptApiKey(): Promise<boolean> {
    const noApiKeyMessage = this.chatGptConfig.get<string>('pageMessage.noApiKey.message')!;
    const noApiKeyChoose1 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose1')!;
    const noApiKeyChoose2 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose2')!;
    const noApiKeyInputTitle = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.title',
    )!;
    const noApiKeyInputPrompt = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.prompt',
    )!;
    const noApiKeyInputPlaceHolder = this.chatGptConfig.get<string>(
      'pageMessage.noApiKey.inputBox.placeHolder',
    )!;
    const choice = await vscode.window.showErrorMessage(
      noApiKeyMessage,
      noApiKeyChoose1,
      noApiKeyChoose2,
    );
    // 如果用户选择了打开设置
    if (choice === noApiKeyChoose2) {
      // 打开关于openai apiKey的设置项
      vscode.commands.executeCommand('workbench.action.openSettings', 'chatgpt.gpt3.apiKey');
      return false;
    } else if (choice === noApiKeyChoose1) {
      const apiKeyValue = await vscode.window.showInputBox({
        title: noApiKeyInputTitle,
        prompt: noApiKeyInputPrompt,
        ignoreFocusOut: true,
        placeHolder: noApiKeyInputPlaceHolder,
      });
      if (apiKeyValue?.trim()) {
        // 全局状态
        const globalState = this.context.globalState;
        // 存储在全局状态中
        globalState.update('chatgpt-gpt3-apiKey', apiKeyValue?.trim());
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  /**
   * @desc 处理问题并将其发送到 API
   * @param {String} question
   * @param {String} code
   * @param {String} language
   * @returns  {String}
   */
  private buildQuestion(question: string, code?: string, language?: string): string {
    if (!!code) {
      // question = `${question}${language ? ` (The following code is in ${language} programming language)` : ''}: ${code}`;
      question = `${question}: ${code}`;
    }
    return question + '\r\n';
  }
  /**
   * @desc 处理问题并将其发送到 API
   * @param {string} prompt
   * @param {SendApiRequestOption} option
   * @returns
   */
  public async sendApiRequest(prompt: string, option: SendApiRequestOption): Promise<void> {
    if (this.inProgress) {
      // 如果正在进行中 给用户一个提示
      const inprogressMessage = this.chatGptConfig.get<string>('pageMessage.thinking.message')!;
      vscode.window.showInformationMessage(inprogressMessage);
      return;
    }
    this.questionCount++;

    // 校验是否登录
    if (!(await this.prepareConversation())) {
      return;
    }
    this.response = '';
    const question = this.buildQuestion(prompt, option.code, option.language);

    if (this.webView === undefined) {
      // 触发resolveWebviewView事件
      await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
      await delay(250);
      if (this.webviewMessageOption !== null) {
        this.sendMessageToWebview(this.webviewMessageOption);
        this.webviewMessageOption = null;
      }
    } else {
      await this.webView?.show?.(true);
    }
    // 记录正在进行的状态
    this.inProgress = true;

    this.abortController = new AbortController();

    this.sendMessageToWebview({
      type: 'show-in-progress',
      inProgress: this.inProgress,
      showStopButton: true,
    });

    this.currentConversationId = this.getRandomId();
    // 要始终保持 messageId 的唯一性
    // this.messageId = this.getRandomId();
    this.sendMessageToWebview({
      type: 'add-question',
      value: prompt,
      code: option.code,
      autoScroll: this.autoScroll,
    });

    try {
      if (this.isGpt35Model && this.chatgpt35Model) {
        const response = await this.chatgpt35Model.sendMessage(question, {
          systemMessage: this.systemMessage,
          // messageId: this.messageId,
          messageId: this.getRandomId(),
          // parentMessageId: this.parentMessageId,
          parentMessageId: this.messageId,
          abortSignal: this.abortController.signal,
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
        this.messageId = response.messageId;
        this.parentMessageId = response.parentMessageId;
      } else if (!this.isGpt35Model && this.chatgpt3Model) {
        const response = await this.chatgpt3Model.sendMessage(question, {
          promptPrefix: this.systemMessage,
          abortSignal: this.abortController.signal,
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
        this.messageId = response.id;
        this.parentMessageId = response.parentMessageId;
      }
      // 如果存在上一个回答
      if (!!option.previousAnswer) {
        this.response = option.previousAnswer + this.response;
      }

      // 判断 chatgpt 是否回答完毕
      const hasContinuation = this.response.split('```').length % 2 === 0;

      if (hasContinuation) {
        this.response = this.response + ' \r\n ```\r\n';
        const dontCompleteMessage = this.chatGptConfig.get<string>(
          'pageMessage.dontComplete.message',
        )!;
        const dontCompleteChoose = this.chatGptConfig.get<string>(
          'pageMessage.dontComplete.choose',
        )!;
        const choice = await vscode.window.showInformationMessage(
          dontCompleteMessage,
          dontCompleteChoose,
        );
        if (choice === dontCompleteChoose) {
          const prompt = this.chatGptConfig.get<string>('pageMessage.dontComplete.prompt') || '';
          this.sendApiRequest(prompt, {
            command: option.command,
            code: undefined,
            previousAnswer: this.response,
          });
        }
      }

      // 回答完毕
      this.sendMessageToWebview({
        type: 'add-answer',
        value: this.response,
        done: true,
        id: this.currentConversationId,
        autoScroll: this.autoScroll,
      });

      // 如果打开了订阅对话的配置
      if (this.subscribeToResponse) {
        // 给用户通知
        const subscribeToResponseMessage =
          this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.message') || '';
        const subscribeToResponseChoose =
          this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.choose') || '';
        vscode.window
          .showInformationMessage(subscribeToResponseMessage, subscribeToResponseChoose)
          .then(async () => {
            // 打开窗口
            await vscode.commands.executeCommand('vscode-chatgpt-plugin.view.focus');
          });
      }
    } catch (error: any) {
      let message;
      let apiMessage =
        error?.response?.data?.error?.message ||
        error?.tostring?.() ||
        error?.message ||
        error?.name;

      if (error?.response?.status || error?.response?.statusText) {
        message = `${error?.response?.status || ''} ${error?.response?.statusText || ''}`;
        // // 从配置中获取错误信息
        // const errorMessage =
        //   this.chatGptConfig.get<string>('pageMessage.maxToken.error.message') || '';
        // // 从配置中获取错误选择
        // const errorChoose =
        //   this.chatGptConfig.get<string>('pageMessage.maxToken.error.choose') || '';
        // vscode.window.showErrorMessage(errorMessage, errorChoose).then(async (choice) => {
        //   if (choice === errorChoose) {
        //     // 执行 清空会话 指令
        //     await vscode.commands.executeCommand('vscode-chatgpt.clearConversation');
        //     // 等待 250毫米
        //     await delay(250);
        //     this.sendApiRequest(prompt, { command: option.command, code: option.code });
        //   }
        // });
      } else if (error.statusCode === 400) {
        message = `your model: '${this.model}' may be incompatible or one of your parameters is unknown. Reset your settings to default. (HTTP 400 Bad Request)`;
      } else if (error.statusCode === 401) {
        message = `Make sure you are properly signed in. 
If you are using Browser Auto-login method, 
make sure the browser is open (You could refresh the browser tab manually if you face any issues, too). 
If you stored your API key in settings.json, make sure it is accurate. 
If you stored API key in session, 
you can reset it with “ChatGPT: Reset session” command.
(HTTP 401 Unauthorized) Potential reasons: \r\n- 1.Invalid Authentication\r\n- 2.Incorrect API key provided.\r\n- 3.Incorrect Organization provided. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.`;
      } else if (error.statusCode === 403) {
        message = 'Your token has expired. Please try authenticating again. (HTTP 403 Forbidden)';
      } else if (error.statusCode === 404) {
        message = `your model: '${this.model}' may be incompatible or you may have exhausted your ChatGPT subscription allowance. (HTTP 404 Not Found)`;
      } else if (error.statusCode === 429) {
        message =
          'Too many requests try again later. (HTTP 429 Too Many Requests) Potential reasons: \r\n 1. You exceeded your current quota, please check your plan and billing details\r\n 2. You are sending requests too quickly \r\n 3. The engine is currently overloaded, please try again later. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      } else if (error.statusCode === 500) {
        message =
          'The server had an error while processing your request, please try again. (HTTP 500 Internal Server Error)\r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      }
      if (apiMessage) {
        message = `${message ? message + ' ' : ''}${apiMessage}`;
      }
      this.sendMessageToWebview({ type: 'add-error', value: message, autoScroll: this.autoScroll });
      return;
    } finally {
      this.inProgress = false;
      this.sendMessageToWebview({ type: 'show-in-progress', inProgress: this.inProgress });
    }
  }
  /**
   * @desc 消息发送器 将消息发送到webview
   * @param {WebviewMessageOption} webviewMessageOption
   * @param {boolean} ignoreMessageIfNullWebView
   * @returns {void}
   */
  public sendMessageToWebview(
    webviewMessageOption: WebviewMessageOption,
    ignoreMessageIfNullWebView?: boolean,
  ): void {
    if (this.webView) {
      this.webView?.webview.postMessage(webviewMessageOption);
    } else if (!ignoreMessageIfNullWebView) {
      this.webviewMessageOption = webviewMessageOption;
    }
  }

  /**
   * @desc 获取webview的html
   * @param {vscode.Webview} webview
   * @returns  {string}
   */
  private getWebviewHtml(webview: vscode.Webview): string {
    const webViewScript = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'web-view.js'),
    );
    const webViewCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'web-view.css'),
    );
    const HighlightCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.css'),
    );
    const HighlightJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.js'),
    );
    const MarkedJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js'),
    );
    const TailwindJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tailwindcss.3.2.4.min.js'),
    );
    const TurndownJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'turndown.js'),
    );
    const features = this.chatGptConfig.get<string>('webview.features');
    const feature1 = this.chatGptConfig.get<string>('webview.feature1');
    const feature2 = this.chatGptConfig.get<string>('webview.feature2');
    const feature3 = this.chatGptConfig.get<string>('webview.feature3');
    const feature4 = this.chatGptConfig.get<string>('webview.feature4');
    const loginButtonName = this.chatGptConfig.get<string>('webview.loginButtonName');
    const loginButtonTitle = this.chatGptConfig.get<string>('webview.loginButtonTitle');
    const updateSettingsButtonName = this.chatGptConfig.get<string>(
      'webview.updateSettingsButtonName',
    );
    const updateSettingsButtonTitle = this.chatGptConfig.get<string>(
      'webview.updateSettingsButtonTitle',
    );
    const updatePromptsButtonName = this.chatGptConfig.get<string>(
      'webview.updatePromptsButtonName',
    );
    const updatePromptsButtonTitle = this.chatGptConfig.get<string>(
      'webview.updatePromptsButtonTitle',
    );

    const questionInputPlaceholder = this.chatGptConfig.get<string>(
      'webview.questionInputPlaceholder',
    );
    const clearConversationButtonName = this.chatGptConfig.get<string>(
      'webview.clearConversationButtonName',
    );
    const clearConversationButtonTitle = this.chatGptConfig.get<string>(
      'webview.clearConversationButtonTitle',
    );

    const showConversationsButtonName = this.chatGptConfig.get<string>(
      'webview.showConversationsButtonName',
    );
    const showConversationsButtonTitle = this.chatGptConfig.get<string>(
      'webview.showConversationsButtonTitle',
    );
    const exportConversationButtonName = this.chatGptConfig.get<string>(
      'webview.exportConversationButtonName',
    );
    const exportConversationButtonTitle = this.chatGptConfig.get<string>(
      'webview.exportConversationButtonTitle',
    );

    // const moreActionsButtonName = this.chatGptConfig.get<string>('webview.moreActionsButtonName');
    const moreActionsButtonTitle = this.chatGptConfig.get<string>('webview.moreActionsButtonTitle');

    // const submitQuestionButtonName = this.chatGptConfig.get<string>(
    //   'webview.submitQuestionButtonName',
    // );
    const submitQuestionButtonTitle = this.chatGptConfig.get<string>(
      'webview.submitQuestionButtonTitle',
    );

    const nonce = this.getRandomId();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${webViewCss}" rel="stylesheet">
				<link href="${HighlightCss}" rel="stylesheet">
				<script src="${HighlightJs}"></script>
				<script src="${MarkedJs}"></script>
				<script src="${TailwindJs}"></script>
				<script src="${TurndownJs}"></script>
			</head>
			<body class="overflow-hidden">
				<div class="flex flex-col h-screen">
          <!-- 整体介绍 -->
					<div id="introduction" class="flex flex-col justify-between h-full justify-center px-6 w-full relative login-screen overflow-auto">
						<div class="flex items-start text-center features-block my-5">
							<div class="flex flex-col gap-3.5 flex-1">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" class="w-6 h-6 m-auto">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"></path>
								</svg>
                <!-- 现有功能 -->
								<h2>${features}</h2>
								<ul class="flex flex-col gap-3.5 text-xs">
                  <!-- 访问您的ChatGPT会话记录 -->
								  <li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature1}</li> 
                  <!-- 改进您的代码，添加测试并找到错误 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature2}</li>
                  <!-- 自动复制或创建新文件 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature3}</li>
                  <!-- 带有自动语言检测的语法高亮显示 -->
									<li class="features-li w-full border border-zinc-700 p-3 rounded-md">${feature4}</li>
								</ul>
							</div>
						</div>
            
						<div class="flex flex-col gap-4 h-full items-center justify-end text-center">
            
              <!-- 登录按钮 -->
							<button id="login-button" class="mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md text-xs" title=${loginButtonTitle}>${loginButtonName}</button>
							
              <!-- 显示对话按钮 -->
              <button id="show-conversations-button2" class="hidden mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md" title="You can access this feature via the kebab menu below. NOTE: Only available with Browser Auto-login method">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg> &nbsp; Show conversations
							</button>
							
              <p class="max-w-sm text-center text-xs text-slate-500">
                <!-- 更新设置和更新提示按钮 -->
								<a id="update-settings-button" title=${updateSettingsButtonTitle} href="#">${updateSettingsButtonName}</a> &nbsp; | &nbsp; <a id="settings-prompt-button" title=${updatePromptsButtonTitle} href="#">${updatePromptsButtonName}</a>
							</p>
						</div>
					</div>

          <!-- gpt 回答的答案列表 -->
					<div class="flex-1 overflow-y-auto text-sm" id="answer-list"></div>
          <!-- gpt 对话列表 -->
					<div class="flex-1 overflow-y-auto hidden" id="conversation-list"></div>

        <!-- gpt 回答的答案的动画  -->
					<div id="in-progress" class="hidden pl-4 pr-4 pt-2 flex items-center justify-between text-xs ">
						<div class="typing flex items-center">
              <span>Asking</span>
              <div class="spinner">
                <div class="bounce1"></div>
                <div class="bounce2"></div>
                <div class="bounce3"></div>
              </div>
            </div>
						
            <!-- gpt 停止回答的答案的按钮 -->
						<button id="stop-asking-button" class="btn btn-primary flex items-center p-1 pr-2 rounded-md ml-5">
							<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Stop responding
						</button>
            </div>

					<div class="p-4 flex items-center pt-2">
						<div class="flex-1 textarea-wrapper">
           <!-- 问题输入框 -->
							<textarea
								type="text"
								rows="1"
								id="question-input"
								placeholder=${questionInputPlaceholder}
								onInput="this.parentNode.dataset.replicatedValue = this.value"></textarea>
						</div>
            <!-- 更多 -->            
						<div id="chat-button-wrapper" class="absolute bottom-14 items-center more-menu right-8 border border-gray-200 shadow-xl hidden text-xs">
            <!-- 清除对话 -->
							<button title=${clearConversationButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="clear-conversation-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                &nbsp;${clearConversationButtonName}
              </button>	
							<!-- 显示对话按钮 -->
              <!--<button title=${showConversationsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="show-conversations-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
                &nbsp;${showConversationsButtonName}
              </button>-->
							<!-- 更新设置 -->
              <button title=${updateSettingsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="update-settings-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                &nbsp;${updateSettingsButtonName}
              </button>
							<!-- 导出对话为markdown -->
              <button title=${exportConversationButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="export-conversation-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                &nbsp;${exportConversationButtonName}
              </button>
						</div>

						<div id="question-input-buttons" class="right-6 absolute p-0.5 ml-5 flex items-center gap-2">
							<!-- 展示更多按钮 -->
              <button id="more-button" title=${moreActionsButtonTitle} class="rounded-lg p-0.5">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" /></svg>
							</button>
              <!-- 提交问题按钮 -->
							<button id="submit-question-button" title=${submitQuestionButtonTitle} class="submit-question-button rounded-lg p-0.5">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
							</button>
						</div>
					</div>
				</div>
      <!-- webview 逻辑代码 -->
				<script nonce="${nonce}" src="${webViewScript}"></script>
			</body>
			</html>`;
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
