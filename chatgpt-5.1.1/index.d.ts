// declare module 'chatgpt-5.1.1' {

import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
type Role = 'user' | 'assistant' | 'system';
type Fetch = typeof fetch;
type ChatGPTAPIOptions = {
  apiKey: string;
  apiBaseUrl?: string;
  debug?: boolean;
  completionParams?: Partial<Omit<openai.CreateChatCompletionRequest, 'messages' | 'n' | 'stream'>>;
  systemMessage?: string;
  /** @defaultValue `4096` **/
  maxModelTokens?: number;
  /** @defaultValue `1000` **/
  maxResponseTokens?: number;
  /** @default undefined */
  organization?: string;
  messageStore?: Keyv;
  getMessageById?: GetMessageByIdFunction;
  upsertMessage?: UpsertMessageFunction;
  fetch?: Fetch;
};
type SendMessageOptions = {
  /** The name of a user in a multi-user chat. */
  name?: string;
  parentMessageId?: string;
  messageId?: string;
  stream?: boolean;
  systemMessage?: string;
  timeoutMs?: number;
  onProgress?: (partialResponse: ChatMessage) => void;
  abortSignal?: AbortSignal;
  completionParams?: Partial<Omit<openai.CreateChatCompletionRequest, 'messages' | 'n' | 'stream'>>;
};
type MessageActionType = 'next' | 'variant';
type SendMessageBrowserOptions = {
  conversationId?: string;
  parentMessageId?: string;
  messageId?: string;
  action?: MessageActionType;
  timeoutMs?: number;
  onProgress?: (partialResponse: ChatMessage) => void;
  abortSignal?: AbortSignal;
};
interface ChatMessage {
  id: string;
  text: string;
  role: Role;
  name?: string;
  delta?: string;
  detail?: any;
  parentMessageId?: string;
  conversationId?: string;
}
declare class ChatGPTError extends Error {
  statusCode?: number;
  statusText?: string;
  isFinal?: boolean;
  accountId?: string;
  reason?: string;
}
type GetMessageByIdFunction = (id: string) => Promise<ChatMessage>;
type UpsertMessageFunction = (message: ChatMessage) => Promise<void>;
type ConversationJSONBody = {
  action: string;

  conversation_id?: string;

  messages: Prompt[];

  model: string;

  parent_message_id: string;
};
type Prompt = {
  content: PromptContent;

  id: string;

  role: Role;
};
type ContentType = 'text';
type PromptContent = {
  content_type: ContentType;

  parts: string[];
};
type ConversationResponseEvent = {
  message?: Message;
  conversation_id?: string;
  error?: string | null;
};
type Message = {
  id: string;
  content: MessageContent;
  role: Role;
  user: string | null;
  create_time: string | null;
  update_time: string | null;
  end_turn: null;
  weight: number;
  recipient: string;
  metadata: MessageMetadata;
};
type MessageContent = {
  content_type: string;
  parts: string[];
};
type MessageMetadata = any;
declare namespace openai {
  interface CreateChatCompletionDeltaResponse {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: [
      {
        delta: {
          role: Role;
          content?: string;
        };
        index: number;
        finish_reason: string | null;
      },
    ];
  }

  interface ChatCompletionRequestMessage {
    role: ChatCompletionRequestMessageRoleEnum;
    content: string;
    name?: string;
  }
  const ChatCompletionRequestMessageRoleEnum: {
    readonly System: 'system';
    readonly User: 'user';
    readonly Assistant: 'assistant';
  };
  type ChatCompletionRequestMessageRoleEnum =
    (typeof ChatCompletionRequestMessageRoleEnum)[keyof typeof ChatCompletionRequestMessageRoleEnum];
  interface ChatCompletionResponseMessage {
    role: ChatCompletionResponseMessageRoleEnum;

    content: string;
  }
  const ChatCompletionResponseMessageRoleEnum: {
    readonly System: 'system';
    readonly User: 'user';
    readonly Assistant: 'assistant';
  };
  type ChatCompletionResponseMessageRoleEnum =
    (typeof ChatCompletionResponseMessageRoleEnum)[keyof typeof ChatCompletionResponseMessageRoleEnum];

  interface CreateChatCompletionRequest {
    /**
     * ID of the model to use. Currently, only `gpt-3.5-turbo` and `gpt-3.5-turbo-0301` are supported.
     * @type {string}
     * @memberof CreateChatCompletionRequest
     */
    model: string;
    /**
     * The messages to generate chat completions for, in the [chat format](/docs/guides/chat/introduction).
     * @type {Array<ChatCompletionRequestMessage>}
     * @memberof CreateChatCompletionRequest
     */
    messages: Array<ChatCompletionRequestMessage>;
    /**
     * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.  We generally recommend altering this or `top_p` but not both.
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    temperature?: number | null;
    /**
     * An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.  We generally recommend altering this or `temperature` but not both.
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    top_p?: number | null;
    /**
     * How many chat completion choices to generate for each input message.
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    n?: number | null;
    /**
     * If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]` message.
     * @type {boolean}
     * @memberof CreateChatCompletionRequest
     */
    stream?: boolean | null;
    /**
     *
     * @type {CreateChatCompletionRequestStop}
     * @memberof CreateChatCompletionRequest
     */
    stop?: CreateChatCompletionRequestStop;
    /**
     * The maximum number of tokens allowed for the generated answer. By default, the number of tokens the model can return will be (4096 - prompt tokens).
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    max_tokens?: number;
    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model\'s likelihood to talk about new topics.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    presence_penalty?: number | null;
    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model\'s likelihood to repeat the same line verbatim.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     * @type {number}
     * @memberof CreateChatCompletionRequest
     */
    frequency_penalty?: number | null;
    /**
     * Modify the likelihood of specified tokens appearing in the completion.  Accepts a json object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.
     * @type {object}
     * @memberof CreateChatCompletionRequest
     */
    logit_bias?: object | null;
    /**
     * A unique identifier representing your end-user, which can help OpenAI to monitor and detect abuse. [Learn more](/docs/guides/safety-best-practices/end-user-ids).
     * @type {string}
     * @memberof CreateChatCompletionRequest
     */
    user?: string;
  }

  type CreateChatCompletionRequestStop = Array<string> | string;
  interface CreateChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<CreateChatCompletionResponseChoicesInner>;
    usage?: CreateCompletionResponseUsage;
  }
  interface CreateChatCompletionResponseChoicesInner {
    index?: number;
    message?: ChatCompletionResponseMessage;
    finish_reason?: string;
  }
  interface CreateCompletionResponseUsage {
    prompt_tokens: number;

    completion_tokens: number;

    total_tokens: number;
  }
}

declare class ChATGPTAPI {
  protected _apiKey: string;
  protected _apiBaseUrl: string;
  protected _debug: boolean;
  protected _systemMessage: string;
  protected _completionParams: Omit<openai.CreateChatCompletionRequest, 'messages' | 'n'>;
  protected _maxModelTokens: number;
  protected _maxResponseTokens: number;
  protected _fetch: Fetch;
  protected _getMessageById: GetMessageByIdFunction;
  protected _upsertMessage: UpsertMessageFunction;
  protected _messageStore: Keyv<ChatMessage>;
  protected _organization: string;
  constructor(opts: ChatGPTAPIOptions);
  sendMessage(text: string, opts?: SendMessageOptions): Promise<ChatMessage>;
  get apiKey(): string;
  set apiKey(apiKey: string);
  protected _buildMessages(
    text: string,
    opts: SendMessageOptions,
  ): Promise<{
    messages: openai.ChatCompletionRequestMessage[];
  }>;
  protected _defaultGetMessageById(id: string): Promise<ChatMessage>;
  protected _defaultUpsertMessage(message: ChatMessage): Promise<void>;
}

export {
  ChATGPTAPI,
  ChatGPTAPIOptions,
  ChatGPTError,
  ChatMessage,
  ContentType,
  ConversationJSONBody,
  ConversationResponseEvent,
  Fetch,
  GetMessageByIdFunction,
  Message,
  MessageActionType,
  MessageContent,
  MessageMetadata,
  Prompt,
  PromptContent,
  Role,
  SendMessageBrowserOptions,
  SendMessageOptions,
  UpsertMessageFunction,
  openai,
};
