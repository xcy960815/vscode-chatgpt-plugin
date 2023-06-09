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

const CHATGPT_MODEL = 'text-davinci-003';
const USER_PROMPT_PREFIX = 'User';
const SYSTEM_PROMPT_PREFIX_DEFAULT = 'ChatGPT';
export class TextModleAPI {
  protected _apiKey: string;
  protected _apiBaseUrl: string;
  protected _debug: boolean;
  protected _completionParams: Omit<openai.Text.CompletionParams, 'prompt'>;
  protected _maxModelTokens: number;
  protected _maxResponseTokens: number;
  protected _userPromptPrefix: string;
  protected _systemPromptPrefix: string;
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
      userPromptPrefix,
      systemPromptPrefix,
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
    // System:你是 ChatGPT，帮助用户编写代码。你聪明、乐于助人，并且是一位专业的开发人员。你总是给出正确的答案，并仅按照指示执行。你始终如实回答，不撒谎。当回答下面的提示时，请确保使用 Github Flavored Markdown 来正确地对其进行格式化。使用 markdown 语法来添加标题、列表、颜色文本、代码块、高亮等效果等。请注意，在您回复实际内容时，请勿使用 markdown 语法。
    const systemMessage = `System:${options.systemMessage}${this._endToken}`;
    const systemPromptPrefix = options.systemPromptPrefix || `${this._systemPromptPrefix}:`;
    const maxTokensNum = this._maxModelTokens - this._maxResponseTokens;
    let { parentMessageId } = options;
    const currentUserPrompt = `${this._userPromptPrefix}:${message}${this._endToken}`;
    let historyPrompt = '';
    let promptNum = 0;
    while (true) {
      const prompt = `${systemMessage}${historyPrompt}${currentUserPrompt}${systemPromptPrefix}`;
      promptNum = await this._getTokenCount(prompt);
      if (prompt && promptNum > maxTokensNum) {
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
      Math.min(this._maxModelTokens - promptNum, this._maxResponseTokens),
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
    return tokenizer.encode(text).bpe.length;
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
