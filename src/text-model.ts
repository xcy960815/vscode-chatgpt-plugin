/* eslint-disable @typescript-eslint/naming-convention */
import Gpt3Tokenizer from 'gpt3-tokenizer';
import isomorphicFetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import type { Fetch, FetchSSEOptions, openai } from './types';
import { fetchSSE } from './utils';

const MODEL = 'text-davinci-003';
const USER_PROMPT_PREFIX = 'User';
const SYSTEM_PROMPT_PREFIX_DEFAULT = 'ChatGPT';
export class TextModleAPI {
  protected _apiKey: string;
  protected _apiBaseUrl: string;
  protected _debug: boolean;
  protected _completionParams: Omit<openai.TextModelAPI.CompletionParams, 'prompt'>;
  protected _maxModelTokens: number;
  protected _maxResponseTokens: number;
  protected _userPromptPrefix: string;
  protected _systemPromptPrefix: string;
  protected _endToken: string;
  protected _sepToken: string;
  protected _fetch: Fetch;
  protected _getMessageById: openai.TextModelAPI.GetMessageById;
  protected _upsertMessage: openai.TextModelAPI.UpsertMessage;
  protected _messageStore: Keyv<openai.TextModelAPI.ChatResponse>;
  protected _organization: string;
  protected gpt3Tokenizer: Gpt3Tokenizer;
  constructor(options: openai.TextModelAPI.ChatgptApiOptions) {
    const {
      apiKey,
      apiBaseUrl,
      organization,
      debug = false,
      messageStore,
      completionParams,
      maxModelTokens,
      maxResponseTokens,
      userPromptPrefix,
      systemPromptPrefix,
      getMessageById,
      upsertMessage,
      fetch,
    } = options;
    this.gpt3Tokenizer = new Gpt3Tokenizer({ type: 'gpt3' });
    this._apiKey = apiKey;
    this._apiBaseUrl = apiBaseUrl || 'https://api.openai.com';
    this._organization = organization || '';
    this._debug = !!debug;
    this._fetch = fetch || isomorphicFetch;
    this._completionParams = {
      model: MODEL,
      temperature: 0.8,
      top_p: 1,
      presence_penalty: 1,
      ...completionParams,
    };
    this._endToken = '<|endoftext|>';
    this._sepToken = this._endToken;
    if (!this._completionParams.stop) {
      this._completionParams.stop = [this._endToken];
    }
    this._maxModelTokens = maxModelTokens || 4096;
    this._maxResponseTokens = maxResponseTokens || 1000;
    this._userPromptPrefix = userPromptPrefix || USER_PROMPT_PREFIX;
    this._systemPromptPrefix = systemPromptPrefix || SYSTEM_PROMPT_PREFIX_DEFAULT;
    this._getMessageById = getMessageById || this._defaultGetMessageById;
    this._upsertMessage = upsertMessage || this._defaultUpsertMessage;
    if (messageStore) {
      this._messageStore = messageStore;
    } else {
      this._messageStore = new Keyv({
        store: new QuickLRU({ maxSize: 10000 }),
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
   * @desc 发送请求到openai
   * @param {string} text
   * @param {openai.TextModelAPI.SendMessageOptions} options
   * @returns {Promise<openai.TextModelAPI.ChatResponse>}
   */
  public async sendMessage(
    text: string,
    options: openai.TextModelAPI.SendMessageOptions,
  ): Promise<openai.TextModelAPI.ChatResponse> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false,
    } = options;
    let { abortSignal } = options;
    let abortController: AbortController | null = null;
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    const userMessage: openai.TextModelAPI.UserMessage = {
      role: 'user',
      messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(userMessage);
    const { prompt, maxTokens } = await this._buildPrompt(text, options);
    const chatResponse: openai.TextModelAPI.ChatResponse = {
      role: 'assistant',
      messageId: uuidv4(),
      parentMessageId: messageId,
      text: '',
    };
    const responseP = new Promise<openai.TextModelAPI.ChatResponse>(async (resolve, reject) => {
      const url = `${this._apiBaseUrl}/v1/completions`;
      const body = {
        ...this._completionParams,
        prompt,
        stream,
        max_tokens: maxTokens,
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
            const response: openai.TextModelAPI.CompletionResponse = JSON.parse(data);
            if (response.id) {
              chatResponse.messageId = response.id;
            }
            if (response?.choices?.length) {
              chatResponse.text += response.choices[0].text;
              chatResponse.detail = response;
              onProgress?.(chatResponse);
            }
          } catch (error) {
            console.warn('ChatGPT stream SEE event unexpected error', error);
            reject(error);
            return;
          }
        };
        fetchSSE(url, fetchSSEOptions, this._fetch).catch(reject);
      } else {
        try {
          const response = await fetchSSE(url, fetchSSEOptions, this._fetch);
          const responseJson: openai.TextModelAPI.CompletionResponse = await response?.json();
          if (responseJson?.id) {
            chatResponse.messageId = responseJson.id;
          }
          if (responseJson?.choices?.length) {
            chatResponse.text = responseJson?.choices[0]?.text?.trim() || '';
          }
          chatResponse.detail = responseJson;
          resolve(chatResponse);
          return;
        } catch (error) {
          return reject(error);
        }
      }
    }).then((messageResult) => {
      return this._upsertMessage(messageResult).then(() => {
        messageResult.parentMessageId = messageResult.messageId;
        return messageResult;
      });
    });
    if (timeoutMs) {
      (responseP as ClearablePromise<openai.TextModelAPI.ChatResponse>).clear = () => {
        abortController?.abort();
      };
      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'ChatGPT timed out waiting for response',
      });
    } else {
      return responseP;
    }
  }
  /**
   * @desc 构建 prompt 获取 maxTokens
   * @param {string} message
   * @param {openai.TextModelAPI.SendMessageOptions} options
   * @returns {Promise<{prompt: string, maxTokens: number}>
   */
  private async _buildPrompt(
    message: string,
    options: openai.TextModelAPI.SendMessageOptions,
  ): Promise<{
    prompt: string;
    maxTokens: number;
  }> {
    const systemMessage = `System:${options.systemMessage}${this._endToken}`;
    const systemPromptPrefix = options.systemPromptPrefix || `${this._systemPromptPrefix}:`;
    const maxTokenCount = this._maxModelTokens - this._maxResponseTokens;
    let { parentMessageId } = options;
    const currentUserPrompt = `${this._userPromptPrefix}:${message}${this._endToken}`;
    let historyPrompt = '';
    let promptTokenCount = 0;
    while (true) {
      const prompt = `${systemMessage}${historyPrompt}${currentUserPrompt}${systemPromptPrefix}`;
      promptTokenCount = await this._getTokenCount(prompt);
      // 当前 prompt token 数量大于最大 token 数量时，不再向上查找
      if (prompt && promptTokenCount > maxTokenCount) {
        break;
      }
      if (!parentMessageId) {
        break;
      }
      const parentMessage = await this._getMessageById(parentMessageId);
      if (!parentMessage) {
        break;
      }
      const parentMessageRole = parentMessage.role;
      const parentMessagePromptPrefix =
        parentMessageRole === 'user' ? this._userPromptPrefix : this._systemPromptPrefix;
      const parentMessagePrompt = `${parentMessagePromptPrefix}:${parentMessage.text}${this._endToken}`;
      historyPrompt = `${parentMessagePrompt}${historyPrompt}`;
      parentMessageId = parentMessage.parentMessageId;
    }
    const prompt = `${systemMessage}${historyPrompt}${currentUserPrompt}${systemPromptPrefix}`;

    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - promptTokenCount, this._maxResponseTokens),
    );
    return { prompt, maxTokens };
  }

  /**
   * @desc 获取token数量
   * @param {string} text
   * @returns {Promise<number>}
   */
  private async _getTokenCount(text: string): Promise<number> {
    return this.gpt3Tokenizer.encode(text).bpe.length;
  }
  /**
   * @desc 获取消息
   * @param {string} id
   * @returns  {Promise<ChatResponse | undefined>}
   */
  private async _defaultGetMessageById(
    id: string,
  ): Promise<openai.TextModelAPI.ChatResponse | undefined> {
    return await this._messageStore.get(id);
  }
  /**
   * @desc 更新消息
   * @param {ChatResponse} message
   * @returns {Promise<void>}
   */
  private async _defaultUpsertMessage(message: openai.TextModelAPI.ChatResponse): Promise<boolean> {
    return await this._messageStore.set(message.messageId, message);
  }

  public async _clearMessage(): Promise<void> {
    return this._messageStore.clear();
  }
}
