/* eslint-disable @typescript-eslint/naming-convention */
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import * as vscode from 'vscode';
import {
  GetMessageById as ChatGetMessageById,
  UpsertMessage as ChatUpsertMessage,
} from './chat-model';
import {
  GetMessageById as TextGetMessageById,
  UpsertMessage as TextUpsertMessage,
} from './text-model';
export type Fetch = typeof fetch;

export interface FetchSSEOptions extends RequestInit {
  onMessage?: (message: string) => void;
}

export interface WebviewMessageOption {
  type:
    | 'show-in-progress'
    | 'login-successful'
    | 'add-answer'
    | 'add-question'
    | 'add-error'
    | 'clear-conversation'
    | 'set-chatgpt-config'
    | 'export-conversation';
  code?: string;
  value?: string | vscode.WorkspaceConfiguration;
  showConversations?: boolean;
  inProgress?: boolean;
  done?: boolean;
  showStopButton?: boolean;
  id?: string;
  autoScroll?: boolean;
}

export interface OnDidReceiveMessageOption {
  type:
    | 'add-question'
    | 'insert-code'
    | 'open-new-tab'
    | 'clear-conversation'
    | 'login'
    | 'open-settings'
    | 'open-prompt-settings'
    | 'show-conversations'
    | 'show-conversation'
    | 'stop-generating'
    | 'get-chatgpt-config';
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
  module Chat {
    interface CompletionResponseDetail {
      message?: string;
    }
    interface CompletionRequestMessage {
      role: CompletionRoleEnum;
      content: string;
    }

    const CompletionRoleEnum: {
      readonly System: 'system';
      readonly User: 'user';
      readonly Assistant: 'assistant';
    };

    type CompletionRoleEnum = (typeof CompletionRoleEnum)[keyof typeof CompletionRoleEnum];

    interface ChatCompletionResponseMessage {
      role: CompletionRoleEnum;
      content: string;
    }

    // 请求参数
    interface CompletionParams {
      model: string;
      messages: Array<CompletionRequestMessage>;
      temperature?: number | null;
      top_p?: number | null;
      n?: number | null;
      stream?: boolean | null;
      stop?: CompletionRequestStop;
      max_tokens?: number;
      presence_penalty?: number | null;
      frequency_penalty?: number | null;
      logit_bias?: object | null;
      user?: string;
    }

    type CompletionRequestStop = Array<string> | string;

    interface CompletionResponseDelta {
      content?: string;
      role?: CompletionRoleEnum;
    }

    interface CompletionResponseChoice {
      index?: number;
      message?: ChatCompletionResponseMessage;
      finish_reason?: string | null;
      delta: CompletionResponseDelta;
    }
    interface CompletionResponse {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<CompletionResponseChoice>;
      detail?: CompletionResponseDetail;
      // usage?: CompletionResponseUsage;
    }

    interface ChatResponse {
      messageId: string;
      text: string;
      role: CompletionRoleEnum;
      detail?: CompletionResponse | null;
      parentMessageId?: string;
      delta?: string;
    }

    interface SendMessageOptions {
      parentMessageId?: string;
      messageId?: string;
      stream?: boolean;
      systemMessage?: string;
      timeoutMs?: number;
      onProgress?: (partialResponse: ChatResponse) => void;
      abortSignal?: AbortSignal;
      completionParams?: Partial<Omit<CompletionParams, 'messages' | 'n' | 'stream'>>;
    }

    interface UserMessage {
      messageId: string;
      role: CompletionRoleEnum;
      text: string;
      messaeId?: string;
      parentMessageId?: string;
    }

    interface ChatgptApiOptions {
      apiKey: string;
      apiBaseUrl?: string;
      debug?: boolean;
      completionParams?: Partial<Omit<CompletionParams, 'messages' | 'n' | 'stream'>>;
      systemMessage?: string;
      /** @defaultValue `4096` **/
      maxModelTokens?: number;
      /** @defaultValue `1000` **/
      maxResponseTokens?: number;
      organization?: string;
      messageStore?: Keyv;
      getMessageById?: ChatGetMessageById;
      upsertMessage?: ChatUpsertMessage;
      fetch?: Fetch;
    }
  }

  module Text {
    const CompletionRoleEnum: {
      // readonly System: 'system';
      readonly User: 'user';
      readonly Assistant: 'assistant';
    };

    type CompletionRoleEnum = (typeof CompletionRoleEnum)[keyof typeof CompletionRoleEnum];

    interface SendMessageOptions {
      parentMessageId?: string;
      messageId?: string;
      stream?: boolean;
      promptPrefix?: string;
      promptSuffix?: string;
      timeoutMs?: number;
      onProgress?: (partialResponse: ChatResponse) => void;
      abortSignal?: AbortSignal;
    }

    interface CompletionParams {
      model: string;
      prompt: string;
      suffix?: string;
      max_tokens?: number;
      temperature?: number;
      top_p?: number;
      logprobs?: number;
      echo?: boolean;
      stop?: string[];
      presence_penalty?: number;
      frequency_penalty?: number;
      best_of?: number;
      logit_bias?: Record<string, number>;
      user?: string;
    }

    interface CompletionResponse {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<CompletionResponseChoice>;
    }

    interface CompletionResponseChoice {
      text?: string;
      index?: number;
      logprobs?: {
        tokens?: Array<string>;
        token_logprobs?: Array<number>;
        top_logprobs?: Array<object>;
        text_offset?: Array<number>;
      } | null;
      finish_reason?: string;
    }

    interface UserMessage {
      messageId: string;
      role: CompletionRoleEnum;
      text: string;
      parentMessageId?: string;
    }

    interface ChatResponse {
      messageId: string;
      text: string;
      role: CompletionRoleEnum;
      parentMessageId?: string;
      detail?: CompletionResponse | null;
    }

    interface ChatgptApiOptions {
      apiKey: string;
      apiBaseUrl?: string;
      debug?: boolean;
      completionParams?: Partial<CompletionParams>;
      maxModelTokens?: number;
      maxResponseTokens?: number;
      userLabel?: string;
      assistantLabel?: string;
      organization?: string;
      messageStore?: Keyv;
      getMessageById?: TextGetMessageById;
      upsertMessage?: TextUpsertMessage;
      fetch?: Fetch;
    }
  }
}
