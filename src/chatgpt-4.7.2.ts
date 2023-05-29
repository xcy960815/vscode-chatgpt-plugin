/* eslint-disable @typescript-eslint/naming-convention */
import GPT3NodeTokenizer from 'gpt3-tokenizer';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import { default as pTimeout } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import type { Fetch } from './types';
import { FetchSSEOptions } from './types';
import { ChatGPTError, fetchSSE } from './utils';

type GetMessageById = (id: string) => Promise<openai.ChatResponse | undefined>;

type UpsertMessage = (message: openai.ChatResponse) => Promise<void>;
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
    conversationId?: string;
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

  // interface ReverseProxyCompletionParams extends CompletionParams {
  //   paid?: boolean;
  // }

  interface CompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<CompletionResponseChoice>;
    // usage?: CompletionResponseUsage;
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

  // interface CompletionResponseUsage {
  //   prompt_tokens: number;
  //   completion_tokens: number;
  //   total_tokens: number;
  // }

  interface UserMessage {
    id: string;
    role: CompletionRequestMessageRoleEnum;
    text: string;
    parentMessageId?: string;
    conversationId?: string;
  }

  interface ChatResponse {
    id: string;
    text: string;
    role: CompletionResponseMessageRoleEnum;
    parentMessageId?: string;
    conversationId?: string;
    detail?: CompletionResponse | null;
  }

  interface ChatgptApiOptions {
    apiKey: string;
    apiBaseUrl?: string;
    apiReverseProxyUrl?: string;
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
export class ChatGPTAPI {
  protected _apiKey: string;
  protected _apiBaseUrl: string;
  protected _apiReverseProxyUrl: string;
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
      apiReverseProxyUrl,
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
    this._apiReverseProxyUrl = apiReverseProxyUrl || '';
    this._debug = !!debug;
    this._fetch = fetch2;
    this._completionParams = {
      model: CHATGPT_MODEL,
      temperature: 0.8,
      top_p: 1,
      presence_penalty: 1,
      ...completionParams,
    };
    if (this._isChatGPTModel) {
      this._endToken = '<|im_end|>';
      this._sepToken = '<|im_sep|>';
      if (!this._completionParams.stop) {
        this._completionParams.stop = [this._endToken, this._sepToken];
      }
    } else if (this._isCodexModel) {
      this._endToken = '</code>';
      this._sepToken = this._endToken;
      if (!this._completionParams.stop) {
        this._completionParams.stop = [this._endToken];
      }
    } else {
      this._endToken = '<|endoftext|>';
      this._sepToken = this._endToken;
      if (!this._completionParams.stop) {
        this._completionParams.stop = [this._endToken];
      }
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
      conversationId = uuidv4(),
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
      id: messageId,
      parentMessageId,
      conversationId,
      text,
    };
    await this._upsertMessage(userMessage);
    let prompt = text;
    let maxTokens = 0;
    if (!this._isCodexModel) {
      const builtPrompt = await this._buildPrompt(text, options);
      prompt = builtPrompt.prompt;
      maxTokens = builtPrompt.maxTokens;
    }
    const chatResponse: openai.ChatResponse = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      conversationId,
      text: '',
    };
    const responseP = new Promise<openai.ChatResponse>(async (resolve, reject) => {
      const url = this._apiReverseProxyUrl || `${this._apiBaseUrl}/v1/completions`;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      };
      if (this._organization) {
        headers['OpenAI-Organization'] = this._organization;
      }
      const body = {
        max_tokens: maxTokens,
        ...this._completionParams,
        prompt,
        stream,
      };
      if (this._debug) {
        const numTokens = await this._getTokenCount(body.prompt);
        console.log(`sendMessage (${numTokens} tokens)`, body);
      }
      const fetchSSEOptions: FetchSSEOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortSignal,
        onMessage: (data) => {
          if (data === '[DONE]') {
            chatResponse.text = chatResponse.text.trim();
            resolve(chatResponse);
            return;
          }
          try {
            const response: openai.CompletionResponse = JSON.parse(data);
            console.log('response', response);

            if (response.id) {
              chatResponse.id = response.id;
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
        },
      };

      if (stream) {
        fetchSSE(url, fetchSSEOptions, this._fetch).catch(reject);
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
            const msg = `ChatGPT error ${res.status || res.statusText}: ${reason}`;
            const error = new ChatGPTError(msg, { cause: res });
            error.statusCode = res.status;
            error.statusText = res.statusText;
            reject(error);
            return;
          }
          const response = await res.json();
          if (this._debug) {
            console.log(response);
          }
          if (response?.id) {
            chatResponse.id = response.id;
          }
          if (response?.choices?.length) {
            chatResponse.text = response.choices[0].text.trim();
          } else {
            return reject(
              new Error(
                `OpenAI error: ${response?.detail?.message || response?.detail || 'unknown'}`,
              ),
            );
          }
          chatResponse.detail = response;
          resolve(chatResponse);
          return;
        } catch (error) {
          return reject(error);
        }
      }
    }).then((message2) => {
      return this._upsertMessage(message2).then(() => message2);
    });
    if (timeoutMs) {
      if (abortController) {
        // @ts-ignore
        responseP.cancel = () => {
          abortController?.abort();
        };
      }
      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'ChatGPT timed out waiting for response',
      });
    } else {
      return responseP;
    }
  }
  get apiKey(): string {
    return this._apiKey;
  }
  set apiKey(apiKey: string) {
    this._apiKey = apiKey;
  }
  /**
   * @desc 提示中允许的最大令牌数。
   * @param {string} message
   * @param {openai.SendMessageOptions} options
   * @returns {Promise<{prompt: string, maxTokens: number}>
   */
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
      `Instructions:
You are ${this._assistantLabel}, a large language model trained by OpenAI.
Current date: ${currentDate}${this._sepToken}`;
    const promptSuffix =
      options.promptSuffix ||
      `
${this._assistantLabel}:
`;
    const maxNumTokens = this._maxModelTokens - this._maxResponseTokens;
    let { parentMessageId } = options;
    let nextPromptBody = `${this._userLabel}:

${message}${this._endToken}`;
    let promptBody = '';
    let prompt;
    let numTokens = 0;
    do {
      const nextPrompt = `${promptPrefix}${nextPromptBody}${promptSuffix}`;
      const nextNumTokens = await this._getTokenCount(nextPrompt);
      const isValidPrompt = nextNumTokens <= maxNumTokens;
      if (prompt && !isValidPrompt) {
        break;
      }
      promptBody = nextPromptBody;
      prompt = nextPrompt;
      numTokens = nextNumTokens;
      if (!isValidPrompt) {
        break;
      }
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
      const parentMessageString = `${parentMessageRoleDesc}:

${parentMessage.text}${this._endToken}

`;
      nextPromptBody = `${parentMessageString}${promptBody}`;
      parentMessageId = parentMessage.parentMessageId;
    } while (true);
    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens),
    );
    return { prompt, maxTokens };
  }
  async _getTokenCount(text: string): Promise<number> {
    if (this._isChatGPTModel) {
      text = text.replace(/<\|im_end\|>/g, '<|endoftext|>');
      text = text.replace(/<\|im_sep\|>/g, '<|endoftext|>');
    }
    return encode(text).length;
  }
  /**
   * @desc 是否是聊天模型
   * @returns {boolean}
   */
  get _isChatGPTModel(): boolean {
    return (
      this._completionParams.model.startsWith('text-chat') ||
      this._completionParams.model.startsWith('text-davinci-002-render')
    );
  }
  /**
   * @desc 是否是codex模型
   * @returns {boolean}
   */
  get _isCodexModel(): boolean {
    return this._completionParams.model.startsWith('code-');
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
  async _defaultUpsertMessage(message: openai.ChatResponse): Promise<void> {
    if (this._debug) {
      console.log('upsertMessage', message.id, message);
    }
    await this._messageStore.set(message.id, message);
  }
}
