/* eslint-disable @typescript-eslint/naming-convention */
import GPT3NodeTokenizer from 'gpt3-tokenizer';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import pTimeout, { ClearablePromise } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import type { Fetch } from './types';
import { FetchSSEOptions } from './types';
import { fetchSSE } from './utils';
type GetMessageById = (id: string) => Promise<openai.ChatResponse | undefined>;

type UpsertMessage = (message: openai.ChatResponse) => Promise<boolean>;

declare namespace openai {
  const CompletionRequestMessageRoleEnum: {
    // readonly System: 'system';
    readonly User: 'user';
    readonly Assistant: 'assistant';
  };

  const CompletionResponseMessageRoleEnum: {
    // readonly System: 'system';
    readonly User: 'user';
    readonly Assistant: 'assistant';
  };

  type CompletionRequestMessageRoleEnum =
    (typeof CompletionRequestMessageRoleEnum)[keyof typeof CompletionRequestMessageRoleEnum];

  type CompletionResponseMessageRoleEnum =
    (typeof CompletionResponseMessageRoleEnum)[keyof typeof CompletionResponseMessageRoleEnum];
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
    role: CompletionRequestMessageRoleEnum;
    text: string;
    parentMessageId?: string;
  }

  interface ChatResponse {
    messageId: string;
    text: string;
    role: CompletionResponseMessageRoleEnum;
    parentMessageId?: string;

    detail?: CompletionResponse | null;
  }

  interface ChatgptApiOptions {
    apiKey: string;
    apiBaseUrl?: string;
    debug?: boolean;
    completionParams?: Partial<openai.CompletionParams>;
    maxModelTokens?: number;
    maxResponseTokens?: number;
    userLabel?: string;
    assistantLabel?: string;
    organization?: string;
    messageStore?: Keyv;
    getMessageById?: GetMessageById;
    upsertMessage?: UpsertMessage;
    fetch?: Fetch;
  }
}

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
  protected _completionParams: Omit<openai.CompletionParams, 'prompt'>;
  protected _maxModelTokens: number;
  protected _maxResponseTokens: number;
  protected _userLabel: string;
  protected _assistantLabel: string;
  protected _endToken: string;
  protected _sepToken: string;
  protected _fetch: Fetch;
  protected _getMessageById: GetMessageById;
  protected _upsertMessage: UpsertMessage;
  protected _messageStore: Keyv<openai.ChatResponse>;
  protected _organization: string;
  constructor(options: openai.ChatgptApiOptions) {
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
    this._apiBaseUrl = apiBaseUrl || 'https://api.openai.com';
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
   * @param {openai.SendMessageOptions} options
   * @returns {Promise<openai.ChatResponse>}
   */
  async sendMessage(
    text: string,
    options: openai.SendMessageOptions,
  ): Promise<openai.ChatResponse> {
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
    const userMessage: openai.UserMessage = {
      role: 'user',
      messageId,
      parentMessageId,
      text,
    };
    await this._upsertMessage(userMessage);
    const { prompt, maxTokens } = await this._buildPrompt(text, options);
    console.log('prompt', prompt);
    console.log('maxTokens', maxTokens);

    const chatResponse: openai.ChatResponse = {
      role: 'assistant',
      messageId: uuidv4(),
      parentMessageId: messageId,
      text: '',
    };
    const responseP = new Promise<openai.ChatResponse>(async (resolve, reject) => {
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
            const response: openai.CompletionResponse = JSON.parse(data);
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
          const responseJson: openai.CompletionResponse = await response?.json();
          if (this._debug) {
            console.log(responseJson);
          }
          if (responseJson?.id) {
            chatResponse.messageId = responseJson.id;
          }
          if (responseJson.choices?.length) {
            // @ts-ignore
            chatResponse.text = responseJson.choices[0].text.trim();
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
      (responseP as ClearablePromise<openai.ChatResponse>).clear = () => {
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
   * @param {openai.SendMessageOptions} options
   * @returns {Promise<{prompt: string, maxTokens: number}>
   */
  // async _buildPrompt(
  //   message: string,
  //   options: openai.SendMessageOptions,
  // ): Promise<{
  //   prompt: string;
  //   maxTokens: number;
  // }> {
  //   const currentDate = new Date().toISOString().split('T')[0];
  //   const promptPrefix =
  //     options.promptPrefix ||
  //     `Instructions:You are ${this._assistantLabel}, a large language model trained by OpenAI.Current date: ${currentDate}${this._sepToken}`;
  //   const promptSuffix = options.promptSuffix || `${this._assistantLabel}:`;
  //   const maxNumTokens = this._maxModelTokens - this._maxResponseTokens;
  //   let { parentMessageId } = options;
  //   let nextPromptBody = `${this._userLabel}:${message}${this._endToken}`;
  //   let promptBody = '';
  //   let prompt;
  //   let numTokens = 0;
  //   do {
  //     const nextPrompt = `${promptPrefix}${nextPromptBody}${promptSuffix}`;
  //     const nextNumTokens = await this._getTokenCount(nextPrompt);
  //     const isValidPrompt = nextNumTokens <= maxNumTokens;
  //     if (prompt && !isValidPrompt) {
  //       break;
  //     }
  //     promptBody = nextPromptBody;
  //     prompt = nextPrompt;
  //     numTokens = nextNumTokens;
  //     if (!isValidPrompt) {
  //       break;
  //     }
  //     if (!parentMessageId) {
  //       break;
  //     }
  //     const parentMessage = await this._getMessageById(parentMessageId);
  //     if (!parentMessage) {
  //       break;
  //     }
  //     const parentMessageRole = parentMessage.role || 'user';
  //     const parentMessageRoleDesc =
  //       parentMessageRole === 'user' ? this._userLabel : this._assistantLabel;
  //     const parentMessageString = `${parentMessageRoleDesc}:${parentMessage.text}${this._endToken}`;
  //     nextPromptBody = `${parentMessageString}${promptBody}`;
  //     parentMessageId = parentMessage.parentMessageId;
  //   } while (true);
  //   const maxTokens = Math.max(
  //     1,
  //     Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens),
  //   );
  //   return { prompt, maxTokens };
  // }
  async _buildPrompt(
    message: string,
    options: openai.SendMessageOptions,
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
  async _getTokenCount(text: string): Promise<number> {
    return encode(text).length;
  }
  /**
   * @desc 获取消息
   * @param {string} id
   * @returns  {Promise<ChatResponse | undefined>}
   */
  async _defaultGetMessageById(id: string): Promise<openai.ChatResponse | undefined> {
    const res = await this._messageStore.get(id);
    if (this._debug) {
      console.log('getMessageById', id, res);
    }
    return res;
  }
  /**
   * @desc 更新消息
   * @param {ChatResponse} message
   * @returns {Promise<void>}
   */
  async _defaultUpsertMessage(message: openai.ChatResponse): Promise<boolean> {
    return await this._messageStore.set(message.messageId, message);
  }
}
