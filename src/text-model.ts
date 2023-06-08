/* eslint-disable @typescript-eslint/naming-convention */
import GPT3NodeTokenizer from 'gpt3-tokenizer';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import type { Fetch, openai } from './types';
import { FetchSSEOptions } from './types';
import { fetchSSE } from './utils';

export type GetMessageById = (id: string) => Promise<openai.Text.ChatResponse | undefined>;

export type UpsertMessage = (message: openai.Text.ChatResponse) => Promise<boolean>;

const tokenizer = new GPT3NodeTokenizer({ type: 'gpt3' });

/**
 * @desc
 * @param {string} input
 * @returns {string[]}
 */
function encode(input: string): number[] {
  return tokenizer.encode(input).bpe;
}

const CHATGPT_MODEL = 'text-davinci-003';
const USER_LABEL_DEFAULT = 'User';
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT';
export class TextModleAPI {
  protected _apiKey: string;
  protected _apiBaseUrl: string;
  protected _debug: boolean;
  protected _completionParams: Omit<openai.Text.CompletionParams, 'prompt'>;
  protected _maxModelTokens: number;
  protected _maxResponseTokens: number;
  protected _userLabel: string;
  protected _assistantLabel: string;
  protected _endToken: string;
  protected _sepToken: string;
  protected _fetch: Fetch;
  protected _getMessageById: GetMessageById;
  protected _upsertMessage: UpsertMessage;
  protected _messageStore: Keyv<openai.Text.ChatResponse>;
  protected _organization: string;
  constructor(options: openai.Text.ChatgptApiOptions) {
    const {
      apiKey,
      apiBaseUrl,
      organization,
      debug = false,
      messageStore,
      completionParams,
      maxModelTokens,
      maxResponseTokens,
      userLabel,
      assistantLabel,
      getMessageById,
      upsertMessage,
      fetch: fetch2 = fetch,
    } = options;
    this._apiKey = apiKey;
    this._apiBaseUrl = apiBaseUrl || 'https://api.openai.Text.com';
    this._organization = organization || '';
    this._debug = !!debug;
    this._fetch = fetch2;
    this._completionParams = {
      model: CHATGPT_MODEL,
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
    this._userLabel = userLabel || USER_LABEL_DEFAULT;
    this._assistantLabel = assistantLabel || ASSISTANT_LABEL_DEFAULT;
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
      throw new Error('ChatGPT invalid apiKey');
    }
    if (!this._fetch) {
      throw new Error('Invalid environment; fetch is not defined');
    }
    if (typeof this._fetch !== 'function') {
      throw new Error('Invalid "fetch" is not a function');
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
   * @param {openai.Text.SendMessageOptions} options
   * @returns {Promise<openai.Text.ChatResponse>}
   */
  public async sendMessage(
    text: string,
    options: openai.Text.SendMessageOptions,
  ): Promise<openai.Text.ChatResponse> {
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
    const userMessage: openai.Text.UserMessage = {
      role: 'user',
      messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(userMessage);
    const { prompt, maxTokens } = await this._buildPrompt(text, options);
    console.log('prompt', prompt);
    console.log('maxTokens', maxTokens);

    const chatResponse: openai.Text.ChatResponse = {
      role: 'assistant',
      messageId: uuidv4(),
      parentMessageId: messageId,
      text: '',
    };
    const responseP = new Promise<openai.Text.ChatResponse>(async (resolve, reject) => {
      const url = `${this._apiBaseUrl}/v1/completions`;
      const body = {
        max_tokens: maxTokens,
        ...this._completionParams,
        prompt,
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
            const response: openai.Text.CompletionResponse = JSON.parse(data);
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
          const responseJson: openai.Text.CompletionResponse = await response?.json();
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
      (responseP as ClearablePromise<openai.Text.ChatResponse>).clear = () => {
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
   * @desc 提示中允许的最大令牌数。
   * @param {string} message
   * @param {openai.Text.SendMessageOptions} options
   * @returns {Promise<{prompt: string, maxTokens: number}>
   */
  private async _buildPrompt(
    message: string,
    options: openai.Text.SendMessageOptions,
  ): Promise<{
    prompt: string;
    maxTokens: number;
  }> {
    const currentDate = new Date().toISOString().split('T')[0];
    const promptPrefix =
      options.promptPrefix ||
      `Instructions:You are ${this._assistantLabel}, a large language model trained by OpenAI.Current date: ${currentDate}${this._sepToken}`;
    const promptSuffix = options.promptSuffix || `${this._assistantLabel}:`;
    const maxNumTokens = this._maxModelTokens - this._maxResponseTokens;
    let { parentMessageId } = options;
    let nextPromptBody = `${this._userLabel}:${message}${this._endToken}`;
    let promptBody = '';
    let prompt;
    let numTokens = 0;

    while (true) {
      const nextPrompt = `${promptPrefix}${nextPromptBody}${promptSuffix}`;
      const nextNumTokens = await this._getTokenCount(nextPrompt);
      if (prompt && nextNumTokens > maxNumTokens) {
        break;
      }
      promptBody = nextPromptBody;
      prompt = nextPrompt;
      numTokens = nextNumTokens;

      if (!parentMessageId) {
        break;
      }

      const parentMessage = await this._getMessageById(parentMessageId);
      if (!parentMessage) {
        break;
      }

      const parentMessageRole = parentMessage.role || 'user';
      const parentMessageRoleDesc =
        parentMessageRole === 'user' ? this._userLabel : this._assistantLabel;
      const parentMessageString = `${parentMessageRoleDesc}:${parentMessage.text}${this._endToken}`;

      nextPromptBody = `${parentMessageString}${promptBody}`;
      parentMessageId = parentMessage.parentMessageId;
    }

    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens),
    );
    return { prompt, maxTokens };
  }

  /**
   * @desc 获取令牌数
   * @param {string} text
   * @returns {Promise<number>}
   * @private
   * @memberof ChatGPT
   */
  private async _getTokenCount(text: string): Promise<number> {
    return encode(text).length;
  }
  /**
   * @desc 获取消息
   * @param {string} id
   * @returns  {Promise<ChatResponse | undefined>}
   */
  private async _defaultGetMessageById(id: string): Promise<openai.Text.ChatResponse | undefined> {
    return await this._messageStore.get(id);
  }
  /**
   * @desc 更新消息
   * @param {ChatResponse} message
   * @returns {Promise<void>}
   */
  private async _defaultUpsertMessage(message: openai.Text.ChatResponse): Promise<boolean> {
    return await this._messageStore.set(message.messageId, message);
  }

  public async _clearMessage(): Promise<void> {
    return this._messageStore.clear();
  }
}
