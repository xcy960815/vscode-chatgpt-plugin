/* eslint-disable @typescript-eslint/naming-convention */
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import * as vscode from 'vscode';
export type Fetch = typeof fetch;

export interface FetchSSEOptions extends RequestInit {
  onMessage?: (message: string) => void;
}

const WebviewMessageOptionssTypeEnums = {
  ShowInProgress: 'show-in-progress',
  AddQuestion: 'add-question',
  AddAnswer: 'add-answer',
  AddError: 'add-error',
  ClearConversation: 'clear-conversation',
  ExportConversation: 'export-conversation',
} as const;

export interface WebviewMessageOptions {
  type: (typeof WebviewMessageOptionssTypeEnums)[keyof typeof WebviewMessageOptionssTypeEnums];
  code?: string;
  value?: string | vscode.WorkspaceConfiguration;
  showConversations?: boolean;
  inProgress?: boolean;
  done?: boolean;
  showStopButton?: boolean;
  id?: string;
  autoScroll?: boolean;
}

const OnDidReceiveMessageOptionsTypeEnums = {
  AddQuestion: 'add-question',
  InsertCode: 'insert-code',
  OpenNewTab: 'open-newtab',
  ClearConversation: 'clear-conversation',
  UpdateKey: 'update-key',
  OpenSettings: 'open-settings',
  OpenPromptSettings: 'open-prompt-settings',
  ShowConversations: 'show-conversations',
  ShowConversation: 'show-conversation',
  StopGenerating: 'stop-generating',
} as const;

export interface OnDidReceiveMessageOptions {
  type: (typeof OnDidReceiveMessageOptionsTypeEnums)[keyof typeof OnDidReceiveMessageOptionsTypeEnums];
  value?: string;
  language?: string;
}

export interface SendApiRequestOption {
  command: string;
  code?: string;
  previousAnswer?: string;
  language?: string;
}

export declare namespace openai {
  // 公共参数
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

  // 公共返回usage
  interface CompletionResponseUsage {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  }

  // 公共返回
  interface CompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    usage: CompletionResponseUsage;
  }
  // 公共参数
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

  interface UserMessage {
    messageId: string;
    text: string;
    parentMessageId?: string;
  }

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

  module GptModelAPI {
    type CompletionRoleEnum =
      (typeof openai.CompletionRoleEnum)[keyof typeof openai.CompletionRoleEnum];

    interface CompletionRequestMessage {
      role: CompletionRoleEnum;
      content: string;
      name?: string;
    }

    // 请求参数
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

    export type GetMessageById = (id: string) => Promise<ApiResponse | undefined>;

    export type UpsertMessage = (message: ApiResponse) => Promise<boolean>;
  }

  module TextModelAPI {
    type CompletionRoleEnum = Exclude<
      typeof openai.CompletionRoleEnum,
      'System'
    >[keyof typeof openai.CompletionRoleEnum];

    interface SendMessageOptions extends openai.SendMessageOptions {
      systemPromptPrefix?: string;
      onProgress?: (partialResponse: ApiResponse) => void;
      CompletionRequestParams?: Partial<Omit<CompletionRequestParams, 'messages' | 'n' | 'stream'>>;
    }

    interface CompletionRequestParams extends openai.CompletionRequestParams {
      prompt: string;
      suffix?: string;
      echo?: boolean;
      best_of?: number;
    }
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

    type GetMessageById = (id: string) => Promise<ApiResponse | undefined>;

    type UpsertMessage = (message: ApiResponse) => Promise<boolean>;
  }
}
