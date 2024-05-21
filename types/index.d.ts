declare interface FetchSSEOptions extends RequestInit {
  onMessage?: (message: string) => void;
}

/**
 * @desc vscode 向 webview 发送的操作事件枚举
 */
declare const WebviewMessageOptionssTypeEnums: {
  ShowInProgress: 'show-in-progress';
  AddQuestion: 'add-question';
  AddAnswer: 'add-answer';
  AddError: 'add-error';
  ClearConversation: 'clear-conversation';
  ExportConversation: 'export-conversation';
};

/**
 * @desc vscode 向 webview 发送的操作事件类型
 */
type WebviewMessageOptionType =
  (typeof WebviewMessageOptionssTypeEnums)[keyof typeof WebviewMessageOptionssTypeEnums];

/**
 * @desc vscode 向 webview 发送的操作事件选项
 */
declare interface WebviewMessageOptions {
  type: WebviewMessageOptionType;
  code?: string;
  value?: string | import('vscode').WorkspaceConfiguration;
  showConversations?: boolean;
  inProgress?: boolean;
  done?: boolean;
  showStopButton?: boolean;
  id?: string;
  autoScroll?: boolean;
}

/**
 * @desc webview 向 vscode 发送事件枚举
 */
declare const OnDidReceiveMessageOptionsTypeEnums: {
  AddQuestion: 'add-question';
  InsertCode: 'insert-code';
  OpenNewTab: 'open-newtab';
  ClearConversation: 'clear-conversation';
  UpdateKey: 'update-key';
  OpenSettings: 'open-settings';
  OpenPromptSettings: 'open-prompt-settings';
  ShowConversations: 'show-conversations';
  ShowConversation: 'show-conversation';
  StopGenerating: 'stop-generating';
};

/**
 * @desc webview 向 vscode 发送事件类型
 */
type OnDidReceiveMessageOptionsType =
  (typeof OnDidReceiveMessageOptionsTypeEnums)[keyof typeof OnDidReceiveMessageOptionsTypeEnums];

/**
 * @desc webview 向 vscode 发送事件选项
 */
declare interface OnDidReceiveMessageOptions {
  type: OnDidReceiveMessageOptionsType;
  value?: string;
  language?: string;
}

declare interface SendApiRequestOption {
  command: string;
  code?: string;
  previousAnswer?: string;
  language?: string;
}

declare type Fetch = typeof import('isomorphic-fetch');

declare type Keyv = import('keyv');

declare namespace openai {
  /**
   * @desc 公共参数
   */
  interface ModelApiOptions {
    apiKey: string;
    apiBaseUrl?: string;
    organization?: string;
    debug?: boolean;
    fetch?: Fetch;
    /** @defaultValue `4096` **/
    maxModelTokens?: number;
    /** @defaultValue `1000` **/
    maxResponseTokens?: number;
    messageStore?: Keyv;
    withContent?: boolean;
  }

  /**
   * @desc 公共返回usage
   */
  interface CompletionResponseUsage {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  }

  /**
   * @desc 公共返回
   */
  interface CompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    /** 当用户设置stream:true时，不会返回 usage 字段 */
    usage?: CompletionResponseUsage;
  }
  /**
   * @desc 公共参数
   */
  interface CompletionRequestParams {
    model: string;
    max_tokens?: number;
    temperature?: number | null;
    top_p?: number | null;
    n?: number | null;
    stream?: boolean | null;
    stop?: Array<string> | string;
    logit_bias?: Record<string, number>;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    user?: string;
  }

  interface CompletionResponseChoice {
    index?: number;
    finish_reason?: string | null;
  }

  /**
   * @desc 公共用户消息
   */
  interface UserMessage {
    messageId: string;
    text: string;
    parentMessageId?: string;
  }

  /**
   * @desc 公共发送消息选项
   */
  interface SendMessageOptions {
    parentMessageId?: string;
    messageId?: string;
    stream?: boolean;
    systemMessage?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }

  interface ApiResponse {
    messageId: string;
    text: string;
    parentMessageId?: string;
  }

  const CompletionRoleEnum: {
    readonly System: 'system';
    readonly User: 'user';
    readonly Assistant: 'assistant';
  };

  interface GptResponse<T = any> extends Response {
    json(): Promise<T>;
  }

  /**
   * @desc gpt 模型模块
   */
  module GptModelAPI {
    type CompletionRoleEnum =
      (typeof openai.CompletionRoleEnum)[keyof typeof openai.CompletionRoleEnum];

    interface CompletionRequestMessage {
      role: CompletionRoleEnum;
      content: string;
      name?: string;
    }

    /**
     * @desc 请求参数
     */
    interface CompletionRequestParams extends openai.CompletionRequestParams {
      messages: Array<CompletionRequestMessage>;
    }

    interface CompletionResponseMessage {
      role: CompletionRoleEnum;
      content: string;
    }
    interface CompletionResponseDelta {
      content?: string;
      role?: CompletionRoleEnum;
    }

    interface CompletionResponseDetail {
      message?: string;
    }

    interface CompletionResponseChoice extends openai.CompletionResponseChoice {
      message?: CompletionResponseMessage;
      delta: CompletionResponseDelta;
    }

    interface CompletionResponse extends openai.CompletionResponse {
      choices: Array<CompletionResponseChoice>;
      detail?: CompletionResponseDetail;
    }

    interface ApiResponse extends openai.ApiResponse {
      role: CompletionRoleEnum;
      detail?: CompletionResponse | null;
      delta?: string;
    }

    interface SendMessageOptions extends openai.SendMessageOptions {
      onProgress?: (partialResponse: ApiResponse) => void;
      CompletionRequestParams?: Partial<Omit<CompletionRequestParams, 'messages' | 'n' | 'stream'>>;
    }

    interface UserMessage extends openai.UserMessage {
      role: CompletionRoleEnum;
    }

    interface GptModelApiOptions extends ModelApiOptions {
      CompletionRequestParams?: Partial<Omit<CompletionRequestParams, 'messages' | 'n' | 'stream'>>;
      systemMessage?: string;
      getMessageById?: GetMessageById;
      upsertMessage?: UpsertMessage;
    }

    /**
     * @desc 通过id获取消息
     */
    export type GetMessageById = (id: string) => Promise<ApiResponse | undefined>;

    /**
     * @desc 更新消息
     */
    export type UpsertMessage = (message: ApiResponse) => Promise<boolean>;
  }

  module TextModelAPI {
    type CompletionRoleEnum = Exclude<
      typeof openai.CompletionRoleEnum,
      'System'
    >[keyof typeof openai.CompletionRoleEnum];

    /**
     * @desc 发送的消息选项
     */
    interface SendMessageOptions extends openai.SendMessageOptions {
      systemPromptPrefix?: string;
      onProgress?: (partialResponse: ApiResponse) => void;
      CompletionRequestParams?: Partial<Omit<CompletionRequestParams, 'messages' | 'n' | 'stream'>>;
    }

    /**
     * 请求参数
     */
    interface CompletionRequestParams extends openai.CompletionRequestParams {
      prompt: string;
      suffix?: string;
      echo?: boolean;
      best_of?: number;
    }

    /**
     * @desc 请求返回
     */
    interface CompletionResponse extends openai.CompletionResponse {
      choices: Array<CompletionResponseChoice>;
    }

    interface CompletionResponseLogprobs {
      tokens?: Array<string>;
      token_logprobs?: Array<number>;
      top_logprobs?: Array<object>;
      text_offset?: Array<number>;
    }

    interface CompletionResponseChoice extends openai.CompletionResponseChoice {
      text?: string;
      logprobs: CompletionResponseLogprobs | null;
    }

    interface UserMessage extends openai.UserMessage {
      role: CompletionRoleEnum;
    }

    interface ApiResponse extends openai.ApiResponse {
      role: CompletionRoleEnum;
      detail?: CompletionResponse;
    }

    interface TextModelApiOptions extends ModelApiOptions {
      CompletionRequestParams?: Partial<CompletionRequestParams>;
      userPromptPrefix?: string;
      systemPromptPrefix?: string;
      getMessageById?: GetMessageById;
      upsertMessage?: UpsertMessage;
    }

    /**
     * @desc 通过id 获取消息
     */
    type GetMessageById = (id: string) => Promise<ApiResponse | undefined>;

    /**
     * @desc 更新插入消息
     */
    type UpsertMessage = (message: ApiResponse) => Promise<boolean>;
  }
}
