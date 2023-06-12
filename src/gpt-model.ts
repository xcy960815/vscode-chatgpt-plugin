/* eslint-disable @typescript-eslint/naming-convention */
import isomorphicFetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import { Fetch, FetchSSEOptions, openai } from './types';
import { fetchSSE } from './utils';

const MODEL = 'gpt-3.5-turbo';

export class GptModelAPI {
  private _apiKey: string;
  private _apiBaseUrl: string;
  private _organization?: string;
  private _debug: boolean;
  private _fetch: Fetch;
  private _completionParams: Partial<
    Omit<openai.GptModelAPI.CompletionParams, 'messages' | 'n' | 'stream'>
  >;
  private _systemMessage: string;
  private _maxModelTokens: number;
  private _maxResponseTokens: number;
  public _getMessageById: openai.GptModelAPI.GetMessageById;
  private _upsertMessage: openai.GptModelAPI.UpsertMessage;
  private _messageStore: Keyv<openai.GptModelAPI.ChatResponse>;
  constructor(options: openai.GptModelAPI.ChatgptApiOptions) {
    const {
      apiKey,
      apiBaseUrl,
      organization,
      debug = false,
      messageStore,
      completionParams,
      systemMessage,
      maxModelTokens = 4000,
      maxResponseTokens = 1000,
      getMessageById,
      upsertMessage,
      fetch,
    } = options;
    this._apiKey = apiKey;
    this._apiBaseUrl = apiBaseUrl || 'https://api.openai.com';
    this._organization = organization;
    this._debug = !!debug;
    this._fetch = fetch || isomorphicFetch;
    this._completionParams = {
      model: MODEL,
      temperature: 0.8,
      top_p: 1,
      presence_penalty: 1,
      ...completionParams,
    };
    this._systemMessage = systemMessage || '';
    this._maxModelTokens = maxModelTokens;
    this._maxResponseTokens = maxResponseTokens;
    this._getMessageById = getMessageById || this._defaultGetMessageById;
    this._upsertMessage = upsertMessage || this._defaultUpsertMessage;
    if (messageStore) {
      this._messageStore = messageStore;
    } else {
      this._messageStore = new Keyv({
        store: new QuickLRU({ maxSize: 1e4 }),
      });
    }
  }
  private get headers(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this._apiKey}`,
    };
    if (this._organization) {
      headers['OpenAI-Organization'] = this._organization;
    }
    return headers;
  }
  /**
   * @desc 发送消息
   * @param {string} text
   * @param {SendMessageOptions} options
   * @returns {Promise<ChatResponse>}
   */
  public async sendMessage(
    text: string,
    options: openai.GptModelAPI.SendMessageOptions,
  ): Promise<openai.GptModelAPI.ChatResponse> {
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
    // 构建用户消息
    const userMessage: openai.GptModelAPI.UserMessage = {
      role: 'user',
      messageId,
      parentMessageId,
      text,
    };
    // 保存用户消息
    await this._upsertMessage(userMessage);

    // 获取用户和gpt历史对话记录
    const { messages } = await this._buildMessages(text, options);

    // 给用户返回的数据
    const chatResponse: openai.GptModelAPI.ChatResponse = {
      role: 'assistant',
      messageId: '',
      parentMessageId: messageId,
      text: '',
      detail: null,
    };
    const responseP = new Promise<openai.GptModelAPI.ChatResponse>(async (resolve, reject) => {
      const url = `${this._apiBaseUrl}/v1/chat/completions`;
      const body = {
        ...this._completionParams,
        ...completionParams,
        messages,
        stream,
      };

      const fetchSSEOptions: FetchSSEOptions = {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: abortSignal,
      };
      if (stream) {
        fetchSSEOptions.onMessage = (data: string) => {
          if (data === '[DONE]') {
            chatResponse.text = chatResponse.text.trim();
            resolve(chatResponse);
            return;
          }
          try {
            const response: openai.GptModelAPI.CompletionResponse = JSON.parse(data);
            if (response.id) {
              chatResponse.messageId = response.id;
            }
            if (response?.choices?.length) {
              const delta = response.choices[0].delta;
              chatResponse.delta = delta.content;
              if (delta?.content) {
                chatResponse.text += delta.content;
              }
              chatResponse.detail = response;
              if (delta?.role) {
                chatResponse.role = delta.role;
              }
              onProgress?.(chatResponse);
            }
          } catch (error) {
            console.error('OpenAI stream SEE event unexpected error', error);
            return reject(error);
          }
        };
        fetchSSE(url, fetchSSEOptions, this._fetch).catch(reject);
      } else {
        try {
          const response = await fetchSSE(url, fetchSSEOptions, this._fetch);
          const responseJson: openai.GptModelAPI.CompletionResponse = await response?.json();
          if (responseJson?.id) {
            chatResponse.messageId = responseJson.id;
          }
          if (responseJson?.choices?.length) {
            const message = responseJson.choices[0].message;
            chatResponse.text = message?.content || '';
            chatResponse.role = message?.role || 'assistant';
          }
          chatResponse.detail = responseJson;
          resolve(chatResponse);
        } catch (error) {
          console.error('OpenAI stream SEE event unexpected error', error);
          return reject(error);
        }
      }
    }).then((messageResult) => {
      return this._upsertMessage(messageResult).then(() => {
        messageResult.parentMessageId = messageResult.messageId;
        return messageResult;
      });
    });

    // 如果设置了超时时间，那么就使用 AbortController
    if (timeoutMs) {
      (responseP as ClearablePromise<openai.GptModelAPI.ChatResponse>).clear = () => {
        abortController?.abort();
      };
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
   * @returns {Promise<{ messages: openai.GptModelAPI.CompletionRequestMessage[]; }>}
   */
  private async _buildMessages(
    text: string,
    options: openai.GptModelAPI.SendMessageOptions,
  ): Promise<{ messages: openai.GptModelAPI.CompletionRequestMessage[] }> {
    const { systemMessage = this._systemMessage } = options;
    let { parentMessageId } = options;
    const messages: openai.GptModelAPI.CompletionRequestMessage[] = [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: text,
      },
    ];

    do {
      if (!parentMessageId) {
        break;
      }
      const parentMessage = await this._getMessageById(parentMessageId);
      if (!parentMessage) {
        break;
      }
      messages.splice(1, 0, {
        role: parentMessage.role,
        content: parentMessage.text,
      });
      parentMessageId = parentMessage.parentMessageId;
    } while (true);

    return { messages };
  }

  /**
   * @desc 获取消息
   * @param {string} id
   * @returns {Promise<ChatResponse | undefined>}
   */
  private async _defaultGetMessageById(
    id: string,
  ): Promise<openai.GptModelAPI.ChatResponse | undefined> {
    const messageOption = await this._messageStore.get(id);
    return messageOption;
  }
  /**
   * @desc 默认更新消息的方法
   * @param {ChatResponse} messageOption
   * @returns {Promise<void>}
   */
  private async _defaultUpsertMessage(
    messageOption: openai.GptModelAPI.ChatResponse,
  ): Promise<boolean> {
    return await this._messageStore.set(messageOption.messageId, messageOption);
  }

  public async _clearMessage(): Promise<void> {
    return await this._messageStore.clear();
  }
}
