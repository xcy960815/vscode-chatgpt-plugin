/* eslint-disable eqeqeq */
/* eslint-disable @typescript-eslint/naming-convention */
import { createParser } from 'eventsource-parser';
import GPT3NodeTokenizer from 'gpt3-tokenizer';
import fetch from 'isomorphic-fetch';
import Keyv from 'keyv';
import { default as pTimeout } from 'p-timeout';
import QuickLRU from 'quick-lru';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { streamAsyncIterable } from './utils';
type Role = 'user' | 'assistant';
type Fetch = typeof fetch;
type SendMessageOptions = {
  conversationId?: string;
  parentMessageId?: string;
  messageId?: string;
  stream?: boolean;
  promptPrefix?: string;
  promptSuffix?: string;
  timeoutMs?: number;
  onProgress?: (partialResponse: ChatMessage) => void;
  abortSignal?: AbortSignal;
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
  parentMessageId?: string;
  conversationId?: string;
  detail?: any;
}
type ChatGPTErrorType =
  | 'unknown'
  | 'chatgpt:pool:account-on-cooldown'
  | 'chatgpt:pool:account-not-found'
  | 'chatgpt:pool:no-accounts'
  | 'chatgpt:pool:timeout'
  | 'chatgpt:pool:rate-limit'
  | 'chatgpt:pool:unavailable';

class ChatGPTError extends Error {
  statusCode?: number;
  statusText?: string;
  isFinal?: boolean;
  accountId?: string;
  type?: ChatGPTErrorType;
  cause?: Response;
  reason?: string;
  constructor(msg: string, options?: { cause: Response }) {
    super(msg);
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}
type GetMessageById = (id: string) => Promise<ChatMessage | undefined>;
type UpsertMessage = (message: ChatMessage) => Promise<void>;
declare namespace openai {
  type CompletionParams = {
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
  };
  type ReverseProxyCompletionParams = CompletionParams & {
    paid?: boolean;
  };
  type CompletionResponse = {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: CompletionResponseChoices;
    usage?: CompletionResponseUsage;
  };
  type CompletionResponseChoices = {
    text?: string;
    index?: number;
    logprobs?: {
      tokens?: Array<string>;
      token_logprobs?: Array<number>;
      top_logprobs?: Array<object>;
      text_offset?: Array<number>;
    } | null;
    finish_reason?: string;
  }[];
  type CompletionResponseUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type ChatGPTAPIOptions = {
  apiKey: string;
  /** @defaultValue `'https://api.openai.com'` **/
  apiBaseUrl?: string;
  /** @defaultValue `undefined` **/
  apiReverseProxyUrl?: string;
  /** @defaultValue `false` **/
  debug?: boolean;
  completionParams?: Partial<openai.CompletionParams>;
  /** @defaultValue `4096` **/
  maxModelTokens?: number;
  /** @defaultValue `1000` **/
  maxResponseTokens?: number;
  /** @defaultValue `'User'` **/
  userLabel?: string;
  /** @defaultValue `'ChatGPT'` **/
  assistantLabel?: string;
  /** @defaultValue `undefined` **/
  organization?: string;
  messageStore?: Keyv;
  getMessageById?: GetMessageById;
  upsertMessage?: UpsertMessage;
  fetch?: Fetch;
};

const tokenizer = new GPT3NodeTokenizer({ type: 'gpt3' });

/**
 * @desc
 * @param {string} input
 * @returns {string[]}
 */
function encode(input: string): number[] {
  return tokenizer.encode(input).bpe;
}
export interface FetchSSERequest extends RequestInit {
  onMessage: (message: string) => void;
}

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
  protected _messageStore: Keyv<ChatMessage>;
  protected _organization: string;
  constructor(options: ChatGPTAPIOptions) {
    const {
      apiKey,
      apiBaseUrl = 'https://api.openai.com',
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
    this._apiBaseUrl = apiBaseUrl;
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
  async sendMessage(text: string, options: SendMessageOptions): Promise<ChatMessage> {
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
    const message: ChatMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      conversationId,
      text,
    };
    await this._upsertMessage(message);
    let prompt = text;
    let maxTokens = 0;
    if (!this._isCodexModel) {
      const builtPrompt = await this._buildPrompt(text, options);
      prompt = builtPrompt.prompt;
      maxTokens = builtPrompt.maxTokens;
    }
    const result: ChatMessage = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      conversationId,
      text: '',
    };
    const responseP = new Promise<ChatMessage>(async (resolve, reject) => {
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
      if (stream) {
        fetchSSE(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal,
            onMessage: (data) => {
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
                  result.text += response.choices[0].text;
                  result.detail = response;
                  onProgress?.(result);
                }
              } catch (err) {
                console.warn('ChatGPT stream SEE event unexpected error', err);
                return reject(err);
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
            result.id = response.id;
          }
          if (response?.choices?.length) {
            result.text = response.choices[0].text.trim();
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
  async _buildPrompt(
    message: string,
    options: SendMessageOptions,
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
   * @returns  {Promise<ChatMessage | undefined>}
   */
  async _defaultGetMessageById(id: string): Promise<ChatMessage | undefined> {
    const res = await this._messageStore.get(id);
    if (this._debug) {
      console.log('getMessageById', id, res);
    }
    return res;
  }
  /**
   * @desc 更新消息
   * @param {ChatMessage} message
   * @returns {Promise<void>}
   */
  async _defaultUpsertMessage(message: ChatMessage): Promise<void> {
    if (this._debug) {
      console.log('upsertMessage', message.id, message);
    }
    await this._messageStore.set(message.id, message);
  }
}
