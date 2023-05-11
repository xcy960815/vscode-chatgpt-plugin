/* eslint-disable @typescript-eslint/naming-convention */
import {
  ChatGPTAPIOptions,
  ChatMessage,
  GetMessageByIdFunction,
  SendMessageOptions,
  UpsertMessageFunction,
  openai,
} from './index';
// import type { EventSourceParseCallback } from "eventsource-parser";
import { createParser } from 'eventsource-parser';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';

class ChatGPTError extends Error {
  statusCode?: number;
  statusText?: string;
  isFinal?: boolean;
  accountId?: string;
  reason?: string;
}

async function* streamAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchSSE(
  url: string,
  options: { [key: string]: any; onMessage: (message: string) => void },
  fetch2: typeof fetch = fetch,
) {
  const { onMessage, ...fetchOptions } = options;
  const res = await fetch2(url, fetchOptions);
  if (!res.ok) {
    let reason;
    try {
      reason = await res.text();
    } catch (err) {
      reason = res.statusText;
    }
    const msg = `ChatGPT error ${res.status}: ${reason}`;
    const error = new ChatGPTError(msg, { cause: res });
    error.statusCode = res.status;
    error.statusText = res.statusText;
    error.reason = reason;
    throw error;
  }
  const parser = createParser((event) => {
    if (event.type === 'event') {
      onMessage(event.data);
    }
  });
  if (!res.body.getReader) {
    const body: any = res.body;
    if (!body.on || !body.read) {
      throw new ChatGPTError('unsupported "fetch" implementation');
    }
    body.on('readable', () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(chunk.toString());
      }
    });
  } else {
    for await (const chunk of streamAsyncIterable(res.body)) {
      const str = new TextDecoder().decode(chunk);
      parser.feed(str);
    }
  }
}

const CHATGPT_MODEL = 'gpt-3.5-turbo';
const USER_LABEL_DEFAULT = 'User';
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT';

class ChatGPTAPI {
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
  private _getMessageById: GetMessageByIdFunction;
  private _upsertMessage: UpsertMessageFunction;
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
      this._messageStore = new Keyv<ChatMessage>({
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

  public async sendMessage(text: string, options: SendMessageOptions): Promise<any> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false,
      completionParams,
    }: {
      parentMessageId?: string;
      messageId?: string;
      timeoutMs?: number;
      onProgress?: (message: any) => void;
      stream?: boolean;
      completionParams?: any;
    } = options;
    let { abortSignal }: { abortSignal?: AbortSignal } = options;
    let abortController: AbortController | null = null;
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    const message: StoredMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(message);
    const { messages } = await this._buildMessages(text, options);

    const result = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      text: '',
      detail: null,
      delta: null,
    };
    const responseP = new Promise(async (resolve, reject) => {
      var _a, _b;
      const url = `${this._apiBaseUrl}/v1/chat/completions`;
      const headers: { [key: string]: string } = {
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
              var _a2;
              if (data === '[DONE]') {
                result.text = result.text.trim();
                return resolve(result);
              }
              try {
                const response = JSON.parse(data);
                if (response.id) {
                  result.id = response.id;
                }
                if (
                  (_a2 = response == null ? void 0 : response.choices) == null ? void 0 : _a2.length
                ) {
                  const delta = response.choices[0].delta;
                  result.delta = delta.content;
                  if (delta == null ? void 0 : delta.content) {
                    result.text += delta.content;
                  }
                  result.detail = response;
                  if (delta.role) {
                    result.role = delta.role;
                  }
                  onProgress == null ? void 0 : onProgress(result);
                }
              } catch (error) {
                console.warn('OpenAI stream SEE event unexpected error', err);
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
            const message2 = response.choices[0].message;
            result.text = message2.content;
            if (message2.role) {
              result.role = message2.role;
            }
          } else {
            const res2 = response;
            return reject(
              new Error(`OpenAI error: ${res2?.detail?.message || res2?.detail || 'unknown'}`),
            );
          }
          result.detail = response;
          return resolve(result);
        } catch (err) {
          return reject(err);
        }
      }
    }).then((message2) => {
      return this._upsertMessage(message2).then(() => message2);
    });
    if (timeoutMs) {
      if (abortController) {
        responseP.cancel = () => {
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

  private async _buildMessages(
    text: string,
    options: BuildMessagesOpts,
  ): Promise<{ messages: Message[] }> {
    const { systemMessage = this._systemMessage } = options;
    let { parentMessageId } = options;
    const userLabel = 'User';
    const assistantLabel = 'Assistant';
    let messages: Message[] = [];
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
  private _defaultGetMessageById(id: string): Promise<ChatMessage | undefined> {
    return this._messageStore.get(id);
  }

  private async _defaultUpsertMessage(message: ChatMessage): Promise<void> {
    await this._messageStore.set(message.id, message);
  }
}
