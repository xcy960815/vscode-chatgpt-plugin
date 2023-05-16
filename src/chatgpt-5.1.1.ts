/* eslint-disable @typescript-eslint/naming-convention */
import { createParser } from 'eventsource-parser';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { streamAsyncIterable } from './utils';

/**
 * @desc Fetches a URL and returns the response as a ReadableStream.
 * @param {String} url
 * @param  {FetchSSERequest} options
 * @param {Fetch} fetch
 */
export async function fetchSSE(url: string, options: FetchSSERequest, fetch: Fetch) {
  const { onMessage, ...fetchOptions } = options;
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    let reason;
    try {
      reason = await response.text();
    } catch (error) {
      reason = response.statusText;
    }
    const errormsg = `ChatGPT error ${response.status}: ${reason}`;
    const error = new ChatGPTError(errormsg, { cause: response });
    error.statusCode = response.status;
    error.statusText = response.statusText;
    error.reason = reason;
    throw error;
  }
  const parser = createParser((event) => {
    if (event.type === 'event') {
      onMessage(event.data);
    }
  });
  const body = response.body;
  const getReader = body?.getReader;
  if (!getReader) {
    const body = response.body as unknown as PassThrough;
    if (!body?.on || !body?.read) {
      throw new ChatGPTError('unsupported "fetch" implementation');
    }
    body.on('readable', () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(chunk.toString());
      }
    });
  } else {
    for await (const chunk of streamAsyncIterable(body)) {
      const str = new TextDecoder().decode(chunk);
      parser.feed(str);
    }
  }
}
export type Fetch = typeof fetch;
export type Role = 'user' | 'assistant' | 'system';

export interface FetchSSERequest extends RequestInit {
  onMessage: (message: string) => void;
}
export type ChatGPTAPIOptions = {
  apiKey: string;
  apiBaseUrl?: string;
  debug?: boolean;
  completionParams?: Partial<Omit<openai.CreateChatCompletionRequest, 'messages' | 'n' | 'stream'>>;
  systemMessage?: string;
  maxModelTokens?: number /** @defaultValue `4096` **/;
  maxResponseTokens?: number /** @defaultValue `1000` **/;
  organization?: string;
  messageStore?: Keyv;
  getMessageById?: GetMessageById;
  upsertMessage?: UpsertMessage;
  fetch?: Fetch;
};

export class ChatGPTError extends Error {
  statusCode?: number;
  statusText?: string;
  isFinal?: boolean;
  accountId?: string;
  reason?: string;
  cause?: Response;
  constructor(msg: string, options?: { cause: Response }) {
    super(msg);
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export declare namespace openai {
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
    model: string;
    messages: Array<ChatCompletionRequestMessage>;
    temperature?: number | null;
    top_p?: number | null;
    n?: number | null;
    stream?: boolean | null;
    stop?: CreateChatCompletionRequestStop;
    max_tokens?: number;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    logit_bias?: object | null;
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

export type GetMessageById = (id: string) => Promise<ChatMessage | undefined>;
export type UpsertMessage = (message: ChatMessage) => Promise<void>;

export interface ChatMessage {
  id: string;
  text: string;
  role: Role;
  name?: string;
  delta?: string;
  detail?: any;
  parentMessageId?: string;
  conversationId?: string;
}

export type SendMessageOptions = {
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
const CHATGPT_MODEL = 'gpt-3.5-turbo';
const USER_LABEL_DEFAULT = 'User';
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT';
export class ChatGPTAPI {
  private _apiKey: string;
  private _apiBaseUrl: string;
  private _organization?: string;
  private _debug: boolean;
  private _fetch: typeof fetch;
  private _completionParams: Partial<
    Omit<openai.CreateChatCompletionRequest, 'messages' | 'n' | 'stream'>
  >;
  private _systemMessage: string;
  private _maxModelTokens: number;
  private _maxResponseTokens: number;
  private _getMessageById: GetMessageById;
  private _upsertMessage: UpsertMessage;
  private _messageStore: Keyv<ChatMessage>;
  constructor(options: ChatGPTAPIOptions) {
    const {
      apiKey,
      apiBaseUrl = 'https://api.openai.com',
      organization,
      debug = false,
      messageStore,
      completionParams,
      systemMessage,
      maxModelTokens = 4000,
      maxResponseTokens = 1000,
      getMessageById,
      upsertMessage,
      fetch: fetch2 = fetch,
    } = options;
    this._apiKey = apiKey;
    this._apiBaseUrl = apiBaseUrl;
    this._organization = organization;
    this._debug = !!debug;
    this._fetch = fetch2;
    this._completionParams = {
      model: CHATGPT_MODEL,
      temperature: 0.8,
      top_p: 1,
      presence_penalty: 1,
      ...completionParams,
    };
    this._systemMessage =
      systemMessage ||
      `You are ChatGPT, a large language model trained by OpenAI.Answer as concisely as possible.Knowledge cutoff: 2021 - 09 - 01 Current date: ${
        new Date().toISOString().split('T')[0]
      }`;
    this._maxModelTokens = maxModelTokens;
    this._maxResponseTokens = maxResponseTokens;
    this._getMessageById = getMessageById || this._defaultGetMessageById;
    this._upsertMessage = upsertMessage || this._defaultUpsertMessage;
    if (messageStore) {
      this._messageStore = messageStore;
    } else {
      this._messageStore = new Keyv({
        store: new QuickLRU({ maxSize: 10000 }),
      });
    }
    if (!this._apiKey) {
      throw new Error('OpenAI missing required apiKey');
    }
    if (!this._fetch) {
      throw new Error('Invalid environment; fetch is not defined');
    }
    if (typeof this._fetch !== 'function') {
      throw new Error('Invalid "fetch" is not a function');
    }
  }
  /**
   * @desc 发送消息
   * @param {string} text
   * @param {SendMessageOptions} options
   * @returns {Promise<ChatMessage>}
   */
  public async sendMessage(text: string, options: SendMessageOptions): Promise<ChatMessage> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false,
      completionParams,
    } = options;
    let { abortSignal } = options;
    let abortController: AbortController | null = null;
    // 如果设置了超时时间，那么就使用 AbortController
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    const message: ChatMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(message);
    const { messages } = await this._buildMessages(text, options);
    // 给用户返回的数据
    const result: ChatMessage = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      text: '',
      detail: null,
      delta: '',
    };
    const responseP = new Promise<ChatMessage>(async (resolve, reject) => {
      const url = `${this._apiBaseUrl}/v1/chat/completions`;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      };
      if (this._organization) {
        headers['OpenAI-Organization'] = this._organization;
      }
      const body = {
        ...this._completionParams,
        ...completionParams,
        messages,
        stream,
      };
      if (stream) {
        fetchSSE(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
            onMessage: (data: string) => {
              if (data === '[DONE]') {
                result.text = result.text.trim();
                resolve(result);
                return;
              }
              try {
                const response: any = JSON.parse(data);
                if (response.id) {
                  result.id = response.id;
                }
                if (response?.choices?.length) {
                  const delta = response.choices[0].delta;
                  result.delta = delta.content;
                  if (delta?.content) {
                    result.text += delta.content;
                  }
                  result.detail = response;
                  if (delta?.role) {
                    result.role = delta.role;
                  }
                  onProgress?.(result);
                }
              } catch (error) {
                console.error('OpenAI stream SEE event unexpected error', error);
                return reject(error);
              }
            },
          },
          this._fetch,
        ).catch(reject);
      } else {
        try {
          const res = await this._fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
          });
          if (!res.ok) {
            const reason = await res.text();
            const msg = `OpenAI error ${res.status || res.statusText}: ${reason}`;
            const error = new ChatGPTError(msg, { cause: res });
            error.statusCode = res.status;
            error.statusText = res.statusText;
            return reject(error);
          }
          const response = await res.json();
          if (this._debug) {
            console.log(response);
          }
          if (response?.id) {
            result.id = response.id;
          }
          if (response?.choices?.length) {
            const message = response.choices[0].message;
            result.text = message.content;
            if (message.role) {
              result.role = message.role;
            }
          } else {
            const res2 = response;
            return reject(
              new Error(`OpenAI error: ${res2?.detail?.message || res2?.detail || 'unknown'}`),
            );
          }
          result.detail = response;
          resolve(result);
          return;
        } catch (err) {
          return reject(err);
        }
      }
    }).then((message2) => {
      return this._upsertMessage(message2).then(() => message2);
    });
    // 如果设置了超时时间，那么就使用 AbortController
    if (timeoutMs) {
      if (abortController) {
        //  cancel
        (responseP as ClearablePromise<ChatMessage>).clear = () => {
          abortController?.abort();
        };
      }
      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'OpenAI timed out waiting for response',
      });
    } else {
      return responseP;
    }
  }
  /**
   * @desc 构建消息
   * @param {string} text
   * @param {SendMessageOptions} options
   * @returns {Promise<{ messages: openai.ChatCompletionRequestMessage[]; }>}
   */
  private async _buildMessages(
    text: string,
    options: SendMessageOptions,
  ): Promise<{ messages: openai.ChatCompletionRequestMessage[] }> {
    const { systemMessage = this._systemMessage } = options;
    let { parentMessageId } = options;
    const userLabel = USER_LABEL_DEFAULT;
    const assistantLabel = ASSISTANT_LABEL_DEFAULT;
    let messages: openai.ChatCompletionRequestMessage[] = [];
    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }
    const systemMessageOffset = messages.length;
    let nextMessages = text
      ? messages.concat([
          {
            role: 'user',
            content: text,
            name: options.name,
          },
        ])
      : messages;

    do {
      const prompt = nextMessages
        .reduce<string[]>((prompt2, message) => {
          switch (message.role) {
            case 'system':
              return prompt2.concat([`Instructions:\n${message.content}`]);
            case 'user':
              return prompt2.concat([`${userLabel}:\n${message.content}`]);
            default:
              return prompt2.concat([`${assistantLabel}:\n${message.content}`]);
          }
        }, [])
        .join('\n\n');

      messages = nextMessages;

      if (!parentMessageId) {
        break;
      }

      const parentMessage = await this._getMessageById(parentMessageId);

      if (!parentMessage) {
        break;
      }

      const parentMessageRole = parentMessage.role || 'user';

      nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
        {
          role: parentMessageRole,
          content: parentMessage.text,
          name: parentMessage.name,
        },
        ...nextMessages.slice(systemMessageOffset),
      ]);

      parentMessageId = parentMessage.parentMessageId;
    } while (true);

    return { messages };
  }
  /**
   * @desc 获取消息
   * @param {string} id
   * @returns {Promise<ChatMessage | undefined>}
   */
  private _defaultGetMessageById(id: string): Promise<ChatMessage | undefined> {
    return this._messageStore.get(id);
  }

  private async _defaultUpsertMessage(message: ChatMessage): Promise<void> {
    await this._messageStore.set(message.id, message);
  }
}
