/* eslint-disable eqeqeq */
/* eslint-disable @typescript-eslint/naming-convention */
import delay from 'delay';
import fetch from 'isomorphic-fetch';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChatGPTAPI as ChatGPTAPI3 } from '../chatgpt-4.7.2/index';
import { ChatGPTAPI as ChatGPTAPI35 } from '../chatgpt-5.1.1/index';
import {
  AuthType,
  LeftOverMessage,
  LoginMethod,
  MessageOption,
  SendApiRequestOption,
} from './types';
export default class ChatgptViewProvider implements vscode.WebviewViewProvider {
  private webView?: vscode.WebviewView;
  // public currentLanguage: typeof vscode.env.language = vscode.env.language;
  // public locales: Locales = require(`../package.nls${vscode.env.language === 'en' ? "" : `${vscode.env.language}`}.json`);
  // 是否允许 ChatGPT 机器人回答您的问题时接收通知。
  public subscribeToResponse: boolean;
  public autoScroll: boolean;
  public useAutoLogin?: boolean;
  public useGpt3?: boolean;
  public chromiumPath?: string;
  public profilePath?: string;

  public model?: string;

  private apiGpt3?: ChatGPTAPI3;
  private apiGpt35?: ChatGPTAPI35;
  private conversationId?: string;
  private messageId?: string;
  private proxyServer?: string;
  private loginMethod?: LoginMethod;
  private authType?: AuthType;

  // 问题数量
  private questionCount: number = 0;
  private inProgress: boolean = false;
  private abortController?: AbortController;
  private currentMessageId: string = '';
  private response: string = '';

  private leftOverMessage?: LeftOverMessage;

  private chatGptConfig: vscode.WorkspaceConfiguration;

  /**
   * 如果消息没有被渲染，则延迟渲染
   * 在调用 resolveWebviewView 之前的时间。
   */
  constructor(private context: vscode.ExtensionContext) {
    this.chatGptConfig = vscode.workspace.getConfiguration('chatgpt');
    this.subscribeToResponse = this.chatGptConfig.get('response.subscribeToResponse') || false;
    this.autoScroll = !!this.chatGptConfig.get('response.autoScroll');
    this.model = this.chatGptConfig.get('gpt3.model');
    this.getWebViewContext();
    this.setMethod();
    this.setChromeExecutablePath();
    this.setProfilePath();
    this.setProxyServer();
    this.setAuthType();
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
    // webviewView.webview.html = this.getWebViewContext();

    // 在监听器内部根据消息命令类型执行不同的操作。
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        // 从webview中获取到用户输入的问题，然后调用sendApiRequest方法发送给后端。
        case 'add-question':
          this.sendApiRequest(data.value, { command: 'freeText' });
          break;
        case 'edit-code':
          const escapedString = (data.value as string).replace(/\$/g, '\\$');
          vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));
          this.logEvent('code-inserted');
          break;
        case 'open-new-tab':
          // 打开新的tab页
          const document = await vscode.workspace.openTextDocument({
            content: data.value,
            language: data.language,
          });
          vscode.window.showTextDocument(document);

          this.logEvent(data.language === 'markdown' ? 'code-exported' : 'code-opened');
          break;

        case 'clear-conversation':
          // 清空会话
          this.messageId = undefined;
          this.conversationId = undefined;
          this.logEvent('conversation-cleared');
          break;
        case 'clear-gpt3':
          this.apiGpt3 = undefined;
          this.logEvent('gpt3-cleared');
          break;
        case 'login':
          const status = await this.prepareConversation();
          if (status) {
            this.sendMessage(
              { type: 'login-successful', showConversations: this.useAutoLogin },
              true,
            );
            this.logEvent('logged-in');
          }
          break;
        case 'open-settings':
          // 打开设置
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt chatgpt.',
          );

          this.logEvent('settings-opened');
          break;
        case 'open-settings-prompt':
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:YOUR_PUBLISHER_NAME.vscode-chatgpt promptPrefix',
          );

          this.logEvent('settings-prompt-opened');
          break;
        case 'show-conversations':
          // 显示对话
          this.logEvent('conversations-list-attempted');
          break;
        case 'show-conversation':
          break;
        case 'stop-generating':
          // 停止生成代码
          this.stopGenerating();
          break;
        case 'get-chatgpt-config':
          this.sendMessage({
            type: 'set-chatgpt-config',
            value: this.chatGptConfig,
          });
          break;
        default:
          break;
      }
    });

    if (!!this.leftOverMessage) {
      // If there were any messages that wasn't delivered, render after resolveWebView is called.
      this.sendMessage(this.leftOverMessage as MessageOption);
      this.leftOverMessage = null;
    }
  }
  /**
   * @desc 终止生成代码
   * @returns {void}
   */
  private stopGenerating(): void {
    this.abortController?.abort?.();
    this.inProgress = false;
    this.sendMessage({ type: 'show-in-progress', inProgress: this.inProgress });
    const responseInMarkdown = !this.isCodexModel;

    this.sendMessage({
      type: 'add-answer',
      value: this.response,
      done: true,
      id: this.currentMessageId,
      autoScroll: this.autoScroll,
      responseInMarkdown,
    });

    this.logEvent('stopped-generating');
  }
  /**
   * @desc 清空会话
   * @returns {void}
   */
  public clearSession(): void {
    this.stopGenerating();
    this.apiGpt3 = undefined;
    this.messageId = undefined;
    this.conversationId = undefined;
    this.logEvent('cleared-session');
  }
  /**
   * @desc 设置代理服务器
   * @returns {void}
   */
  public setProxyServer(): void {
    this.proxyServer = this.chatGptConfig.get('proxyServer');
  }
  /**
   * @desc
   */
  public setMethod(): void {
    this.loginMethod = this.chatGptConfig.get<LoginMethod>('method');
    this.useGpt3 = true;
    this.useAutoLogin = false;
    this.clearSession();
  }

  public setAuthType(): void {
    this.authType = this.chatGptConfig.get('authenticationType');
    this.clearSession();
  }
  /**
   * @desc 设置chrome执行路径
   * @returns {void}
   */
  public setChromeExecutablePath(): void {
    let path = '';
    switch (os.platform()) {
      case 'win32':
        path = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        break;

      case 'darwin':
        path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        break;

      default:
        const chromeExists = fs.existsSync('/usr/bin/google-chrome');

        path = chromeExists ? '/usr/bin/google-chrome' : '/usr/bin/google-chrome-stable';
        break;
    }

    this.chromiumPath = this.chatGptConfig.get('chromiumPath') || path;
    this.clearSession();
  }

  public setProfilePath(): void {
    this.profilePath = this.chatGptConfig.get('profilePath');
    this.clearSession();
  }
  /**
   * @desc chatgpt模型是否是 "code-davinci-002","code-cushman-001"
   * @returns {boolean}
   */
  private get isCodexModel(): boolean {
    return !!this.model?.startsWith('code-');
  }
  /**
   * @desc chatgpt模型是否是 "gpt-3.5-turbo","gpt-3.5-turbo-0301","gpt-4"
   * @returns {boolean}
   */
  private get isGpt35Model(): boolean {
    return !!this.model?.startsWith('gpt-');
  }
  /**
   * @desc 回话前准备
   * @param {boolean} modelChanged
   * @returns {Promise<boolean>}
   */
  public async prepareConversation(modelChanged?: boolean): Promise<boolean> {
    if (modelChanged && this.useAutoLogin) {
      // no need to reinitialize in autologin when model changes
      return false;
    }
    if (this.useGpt3) {
      if (
        (this.isGpt35Model && !this.apiGpt35) ||
        (!this.isGpt35Model && !this.apiGpt3) ||
        modelChanged
      ) {
        // 全局状态
        const globalState = this.context.globalState;
        let chatgptApiKey =
          this.chatGptConfig.get<string>('gpt3.apiKey') ||
          globalState.get<string>('chatgpt-gpt3-apiKey');
        const organization = this.chatGptConfig.get<string>('gpt3.organization');
        const max_tokens = this.chatGptConfig.get<number>('gpt3.maxTokens');
        const temperature = this.chatGptConfig.get<number>('gpt3.temperature');
        const top_p = this.chatGptConfig.get<number>('gpt3.top_p');
        const apiBaseUrl = this.chatGptConfig.get<string>('gpt3.apiBaseUrl');
        const noApiKeyMessage = this.chatGptConfig.get<string>('pageMessage.noApiKey.message')!;
        const choose1 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose1')!;
        const choose2 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose2')!;
        // 检查apiKey是否存在
        if (!chatgptApiKey) {
          vscode.window.showErrorMessage(noApiKeyMessage, choose1, choose2).then(async (choice) => {
            // 如果用户选择了打开设置
            if (choice === choose2) {
              // 打开 关于openai apiKey的设置项
              vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'chatgpt.gpt3.apiKey',
              );
              return false;
            } else if (choice === choose1) {
              const title = this.chatGptConfig.get<string>('pageMessage.noApiKey.inputBox.title')!;
              const prompt = this.chatGptConfig.get<string>(
                'pageMessage.noApiKey.inputBox.prompt',
              )!;
              const placeHolder = this.chatGptConfig.get<string>(
                'pageMessage.noApiKey.inputBox.placeHolder',
              )!;
              // 如果用户选择了存储在会话中
              await vscode.window
                .showInputBox({
                  title,
                  prompt,
                  ignoreFocusOut: true,
                  placeHolder,
                  value: chatgptApiKey || '',
                })
                .then((value) => {
                  if (value) {
                    chatgptApiKey = value.trim();
                    // 存储在全局状态中
                    globalState.update('chatgpt-gpt3-apiKey', chatgptApiKey);
                    this.sendMessage(
                      { type: 'login-successful', showConversations: this.useAutoLogin },
                      true,
                    );
                  }
                });
            }
          });

          return false;
        }
        console.log('this.isGpt35Model', this.isGpt35Model);

        // 初始化 chatgpt 模型
        if (this.isGpt35Model) {
          this.apiGpt35 = new ChatGPTAPI35({
            apiKey: chatgptApiKey,
            fetch: fetch,
            apiBaseUrl: apiBaseUrl?.trim() || undefined,
            organization,
            completionParams: {
              model: this.model,
              max_tokens,
              temperature,
              top_p,
            },
          });
        } else {
          this.apiGpt3 = new ChatGPTAPI3({
            apiKey: chatgptApiKey,
            fetch: fetch,
            apiBaseUrl: apiBaseUrl?.trim() || undefined,
            organization,
            completionParams: {
              model: this.model,
              max_tokens,
              temperature,
              top_p,
            },
          });
        }
      }
    }

    this.sendMessage({ type: 'login-successful', showConversations: this.useAutoLogin }, true);

    return true;
  }
  /**
   * @desc 给chatgpt的系统信息
   */
  private get systemMessage(): string {
    return this.chatGptConfig.get<string>('gpt3.systemMessage') || '';
  }
  /**
   * @desc 处理问题并将其发送到 API
   * @param {String} question
   * @param {String} code
   * @param {String} language
   * @returns  {String}
   */
  private processQuestion(question: string, code?: string, language?: string): string {
    if (!!code) {
      question = `${question}${
        language ? ` (The following code is in ${language} programming language)` : ''
      }: ${code}`;
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
      // 给用户一个提示
      const inprogressMessage = this.chatGptConfig.get<string>('pageMessage.inProgress.message')!;
      vscode.window.showInformationMessage(inprogressMessage);
      return;
    }

    this.questionCount++;

    // this.logEvent('api-request-sent', {
    // 	'chatgpt.command': option.command,
    // 	'chatgpt.hasCode': String(!!option.code),
    // 	'chatgpt.hasPreviousAnswer': String(!!option.previousAnswer),
    // });

    if (!(await this.prepareConversation())) {
      return;
    }

    this.response = '';

    const question = this.processQuestion(prompt, option.code, option.language);

    const responseInMarkdown = !this.isCodexModel;

    if (this.webView == null) {
      vscode.commands.executeCommand('vscode-chatgpt.view.focus');
    } else {
      this.webView?.show?.(true);
    }
    // 记录正在进行的状态
    this.inProgress = true;

    this.abortController = new AbortController();

    this.sendMessage({
      type: 'show-in-progress',
      inProgress: this.inProgress,
      showStopButton: this.useGpt3,
    });

    this.currentMessageId = this.getRandomId();

    this.sendMessage({
      type: 'add-question',
      value: prompt,
      code: option.code,
      autoScroll: this.autoScroll,
    });

    try {
      if (this.useGpt3) {
        if (this.isGpt35Model && this.apiGpt35) {
          const gpt3Response = await this.apiGpt35.sendMessage(question, {
            systemMessage: this.systemMessage,
            messageId: this.conversationId,
            parentMessageId: this.messageId,
            abortSignal: this.abortController.signal,
            onProgress: (partialResponse) => {
              this.response = partialResponse.text;
              this.sendMessage({
                type: 'add-answer',
                value: this.response,
                id: this.currentMessageId,
                autoScroll: this.autoScroll,
                responseInMarkdown,
              });
            },
          });
          ({
            text: this.response,
            id: this.conversationId,
            parentMessageId: this.messageId,
          } = gpt3Response);
        } else if (!this.isGpt35Model && this.apiGpt3) {
          ({
            text: this.response,
            conversationId: this.conversationId,
            parentMessageId: this.messageId,
          } = await this.apiGpt3.sendMessage(question, {
            promptPrefix: this.systemMessage,
            abortSignal: this.abortController.signal,
            onProgress: (partialResponse) => {
              this.response = partialResponse.text;
              this.sendMessage({
                type: 'add-answer',
                value: this.response,
                id: this.currentMessageId,
                autoScroll: this.autoScroll,
                responseInMarkdown,
              });
            },
          }));
        }
      }

      if (option.previousAnswer != null) {
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
        vscode.window
          .showInformationMessage(dontCompleteMessage, dontCompleteChoose)
          .then(async (choice) => {
            if (choice === dontCompleteChoose) {
              const prompt =
                this.chatGptConfig.get<string>('pageMessage.dontComplete.prompt') || '';
              this.sendApiRequest(prompt, {
                command: option.command,
                code: undefined,
                previousAnswer: this.response,
              });
            }
          });
      }

      this.sendMessage({
        type: 'add-answer',
        value: this.response,
        done: true,
        id: this.currentMessageId,
        autoScroll: this.autoScroll,
        responseInMarkdown,
      });

      // 如果打开了订阅对话的配置
      if (this.subscribeToResponse) {
        const subscribeToResponseMessage =
          this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.message') || '';
        const subscribeToResponseChoose =
          this.chatGptConfig.get<string>('pageMessage.subscribeToResponse.choose') || '';
        vscode.window
          .showInformationMessage(subscribeToResponseMessage, subscribeToResponseChoose)
          .then(async () => {
            // 打开窗口
            await vscode.commands.executeCommand('vscode-chatgpt.view.focus');
          });
      }
    } catch (error: any) {
      let message;
      let apiMessage =
        error?.response?.data?.error?.message ||
        error?.tostring?.() ||
        error?.message ||
        error?.name;

      this.logError('api-request-failed');

      if (error?.response?.status || error?.response?.statusText) {
        message = `${error?.response?.status || ''} ${error?.response?.statusText || ''}`;
        // 从配置中获取错误信息
        const errorMessage =
          this.chatGptConfig.get<string>('pageMessage.maxToken.error.message') || '';
        // 从配置中获取错误选择
        const errorChoose =
          this.chatGptConfig.get<string>('pageMessage.maxToken.error.choose') || '';
        vscode.window.showErrorMessage(errorMessage, errorChoose).then(async (choice) => {
          if (choice === errorChoose) {
            // 执行 清空会话 指令
            await vscode.commands.executeCommand('vscode-chatgpt.clearConversation');
            // 等待 250毫米
            await delay(250);
            this.sendApiRequest(prompt, { command: option.command, code: option.code });
          }
        });
      } else if (error.statusCode === 400) {
        message = `Your method: '${this.loginMethod}' and your model: '${this.model}' may be incompatible or one of your parameters is unknown. Reset your settings to default. (HTTP 400 Bad Request)`;
      } else if (error.statusCode === 401) {
        message =
          'Make sure you are properly signed in. If you are using Browser Auto-login method, make sure the browser is open (You could refresh the browser tab manually if you face any issues, too). If you stored your API key in settings.json, make sure it is accurate. If you stored API key in session, you can reset it with `ChatGPT: Reset session` command. (HTTP 401 Unauthorized) Potential reasons: \r\n- 1.Invalid Authentication\r\n- 2.Incorrect API key provided.\r\n- 3.Incorrect Organization provided. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      } else if (error.statusCode === 403) {
        message = 'Your token has expired. Please try authenticating again. (HTTP 403 Forbidden)';
      } else if (error.statusCode === 404) {
        message = `Your method: '${this.loginMethod}' and your model: '${this.model}' may be incompatible or you may have exhausted your ChatGPT subscription allowance. (HTTP 404 Not Found)`;
      } else if (error.statusCode === 429) {
        message =
          'Too many requests try again later. (HTTP 429 Too Many Requests) Potential reasons: \r\n 1. You exceeded your current quota, please check your plan and billing details\r\n 2. You are sending requests too quickly \r\n 3. The engine is currently overloaded, please try again later. \r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      } else if (error.statusCode === 500) {
        message =
          'The server had an error while processing your request, please try again. (HTTP 500 Internal Server Error)\r\n See https://platform.openai.com/docs/guides/error-codes for more details.';
      }

      if (apiMessage) {
        message = `${message ? message + ' ' : ''}

	${apiMessage}
`;
      }
      this.sendMessage({ type: 'add-error', value: message, autoScroll: this.autoScroll });
      return;
    } finally {
      this.inProgress = false;
      this.sendMessage({ type: 'show-in-progress', inProgress: this.inProgress });
    }
  }

  /**
   * @desc 消息发送器 将消息发送到webview
   * @param {MessageOption} message
   * @param {boolean} ignoreMessageIfNullWebView
   * @returns {void}
   */
  public sendMessage(messageOption: MessageOption, ignoreMessageIfNullWebView?: boolean): void {
    if (this.webView) {
      this.webView?.webview.postMessage(messageOption);
    } else if (!ignoreMessageIfNullWebView) {
      this.leftOverMessage = messageOption;
    }
  }

  private logEvent(eventName: string, properties?: {}): void {
    // You can initialize your telemetry reporter and consume it here - *replaced with console.debug to prevent unwanted telemetry logs
    // this.reporter?.sendTelemetryEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCount": this.questionCount });
    // console.debug(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown", ...properties }, { "chatgpt.questionCount": this.questionCount });
  }

  private logError(eventName: string): void {
    // You can initialize your telemetry reporter and consume it here - *replaced with console.error to prevent unwanted telemetry logs
    // this.reporter?.sendTelemetryErrorEvent(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCount": this.questionCount });
    // console.error(eventName, { "chatgpt.loginMethod": this.loginMethod!, "chatgpt.authType": this.authType!, "chatgpt.model": this.model || "unknown" }, { "chatgpt.questionCount": this.questionCount });
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
    /**
     * highlight.css 包是一个基于 highlight.js 的语法高亮度显示样式库。
     * 它提供了一系列漂亮的预定义样式，可以应用于任何使用 highlight.js 库进行代码高亮的项目中。
     * 当你在你的网站或博客中需要为代码段设置语法高亮时，你可以使用 highlight.css 来实现界面美观度更高，风格更加多样化的效果。
     * 通过引入该库提供的 CSS 样式，你可以快速而轻松地将已经使用 highlight.js 高亮处理过的代码块呈现成更具有吸引力的方式。
     */
    const HighlightCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.css'),
    );
    /**
     * highlight.js 是一个 JavaScript 语法高亮显示库，支持多种编程语言和文档格式。
     * 它可以在代码片段上自动进行色彩编码，而不需要额外的配置。
     * 它适用于各种网站、博客（例如 WordPress 等）、平台（例如 GitHub、Reddit）以及其他应用程序中。
     * 另外，highlight.js 还提供了对可读性更强的 CSS 样式的支持，可以轻松定制代码块的样式。
     * 它可以在浏览器端直接使用，也可以在 Node.js 中使用。
     */
    const HighlightJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'highlight.min.js'),
    );
    /**
     * markedjs是一个流行的用于将Markdown语法转换成HTML代码的JavaScript库。
     * 它可以将包含Markdown的字符串解析成HTML，同时保留Markdown原始文本中的样式。
     * 这个库简单易用，支持GFM（GitHub风格的Markdown）以及其他一些扩展语法，例如：表格、代码块、任务列表、删除线等等。该库还支持自定义选项和各种插件，提供广泛的选择来生成所需的格式化输出。
     * 由于其方便快捷、性能好，因此很受欢迎，常常用于编写Markdown编辑器或博客系统。
     */
    const MarkedJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js'),
    );
    /**
     * tailwindcss 是一个全新的、未来感极强的 CSS 框架，它能够帮助开发人员快速构建现代、美观且高效的网站。
     * 与传统的 CSS 框架不同，Tailwind 不是提供单独的CSS类，而是通过一组小型的原子级别类来构建 UI 界面。例如, Tailwind 提供了用于颜色、字体、定位、边框等元素的简单 CSS 类，并在组合这些类时提供了大量自定义选项。
     * 使用 tailwindcss 可以让开发者尽可能的最小化 CSS 代码，同时也避免了样式冗余和未使用样式的 wastage。
     * 另外，Tailwind 具有复用性高的特点，可以让开发者在任何情况下轻松定制并扩展框架。
     * 总之，tailwindcss可以帮助开发者更加高效地编写 CSS 样式和快速构建出更具有现代感及美观的 Web 应用程序。
     */
    const TailwindJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'tailwindcss.3.2.4.min.js'),
    );
    /**
     * Turndown.js 是一个用于将HTML转换为markdown格式的JavaScript库。它可以将大部分 HTML 标记转换为与之等价的 markdown 语法。
     * Turndown.js可在浏览器端和Node.js环境中运行。
     * 由于 Turndown.js 能够将HTML文本转换为 Markdown 格式的文本，所以Turndown.js是许多应用程序中非常有用的一个工具包。
     * 它可以帮助将从富文本编辑器、博客等地方获取到的HTML数据转化为Markdown格式，并进行展示或者存储。
     */
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

    const moreActionsButtonName = this.chatGptConfig.get<string>('webview.moreActionsButtonName');
    const moreActionsButtonTitle = this.chatGptConfig.get<string>('webview.moreActionsButtonTitle');

    const submitQuestionButtonName = this.chatGptConfig.get<string>(
      'webview.submitQuestionButtonName',
    );
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
              <button id="list-conversations-link" class="hidden mb-4 btn btn-primary flex gap-2 justify-center p-3 rounded-md" title="You can access this feature via the kebab menu below. NOTE: Only available with Browser Auto-login method">
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

        <!-- gpt 回答的答案的动画 -->
					<div id="in-progress" class="hidden pl-4 pr-4 pt-2 flex items-center justify-between text-xs ">
						<div class="typing flex items-center">
              <span>Thinking</span>
              <div class="spinner">
                <div class="bounce1"></div>
                <div class="bounce2"></div>
                <div class="bounce3"></div>
              </div>
            </div>
						
            <!-- gpt 停止回答的答案的按钮 -->
						<button id="stop-asking-button" class="btn btn-primary flex items-end p-1 pr-2 rounded-md ml-5">
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
							<!-- 显示对话 -->
              <button title=${showConversationsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="show-conversations-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
                &nbsp;${showConversationsButtonName}
              </button>
							<!-- 更新设置 -->
              <button title=${updateSettingsButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="update-settings-button">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                &nbsp;${updateSettingsButtonName}
              </button>
							<!-- 导出对话为markdown -->
              <button title=${exportConversationButtonTitle} class="flex gap-2 items-center justify-start p-2 w-full" id="export-conversation-2-markdown-button">
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

  /**
   * @desc 获取webview的内容
   * @returns {string}
   */
  private getWebViewContext(): string {
    const webviewHtmlPath = path.join(this.context.extensionPath, 'media', 'web-view.html');
    const documentPath = path.dirname(webviewHtmlPath);
    // fs 读取文件
    let html = fs.readFileSync(webviewHtmlPath, 'utf-8');
    // vscode 不支持直接加载本地资源，需要替换成其专有路径格式，这里只是简单的将样式和JS的路径替换
    return html.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (_m, $1, $2) => {
      return `${$1}${this.webView?.webview.asWebviewUri(
        vscode.Uri.file(path.resolve(documentPath, $2)),
      )}"`;
    });
  }
}
