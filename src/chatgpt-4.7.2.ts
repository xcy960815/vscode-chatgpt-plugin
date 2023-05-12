/* eslint-disable eqeqeq */
/* eslint-disable @typescript-eslint/naming-convention */
import { createParser } from 'eventsource-parser';
import GPT3TokenizerImport from 'gpt3-tokenizer';
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
    /** 使用的模型id */
    model: string;
    /** 要生成完成文本的提示字符串 */
    prompt: string;
    /**
     * 插入文本的完成后缀
     */
    suffix?: string;
    /**
     * The maximum number of tokens to generate in the completion.  The token count of your prompt plus `max_tokens` cannot exceed the model\'s context length. Most models have a context length of 2048 tokens (except for the newest models, which support 4096).
     */
    max_tokens?: number;
    /**
     * What [sampling temperature](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277) to use. Higher values means the model will take more risks. Try 0.9 for more creative applications, and 0 (argmax sampling) for ones with a well-defined answer.  We generally recommend altering this or `top_p` but not both.
     */
    temperature?: number;
    /**
     * An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.  We generally recommend altering this or `temperature` but not both.
     */
    top_p?: number;
    /**
     * Include the log probabilities on the `logprobs` most likely tokens, as well the chosen tokens. For example, if `logprobs` is 5, the API will return a list of the 5 most likely tokens. The API will always return the `logprob` of the sampled token, so there may be up to `logprobs+1` elements in the response.  The maximum value for `logprobs` is 5. If you need more than this, please contact us through our [Help center](https://help.openai.com) and describe your use case.
     */
    logprobs?: number;
    /**
     * Echo back the prompt in addition to the completion
     */
    echo?: boolean;
    /**
     * Up to 4 sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.
     */
    stop?: string[];
    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model\'s likelihood to talk about new topics.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     */
    presence_penalty?: number;
    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model\'s likelihood to repeat the same line verbatim.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     */
    frequency_penalty?: number;
    /**
     * Generates `best_of` completions server-side and returns the \"best\" (the one with the highest log probability per token). Results cannot be streamed.  When used with `n`, `best_of` controls the number of candidate completions and `n` specifies how many to return – `best_of` must be greater than `n`.  **Note:** Because this parameter generates many completions, it can quickly consume your token quota. Use carefully and ensure that you have reasonable settings for `max_tokens` and `stop`.
     */
    best_of?: number;
    /**
     * Modify the likelihood of specified tokens appearing in the completion.  Accepts a json object that maps tokens (specified by their token ID in the GPT tokenizer) to an associated bias value from -100 to 100. You can use this [tokenizer tool](/tokenizer?view=bpe) (which works for both GPT-2 and GPT-3) to convert text to token IDs. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.  As an example, you can pass `{\"50256\": -100}` to prevent the <|endoftext|> token from being generated.
     */
    logit_bias?: Record<string, number>;
    /**
     * A unique identifier representing your end-user, which will help OpenAI to monitor and detect abuse. [Learn more](/docs/usage-policies/end-user-ids).
     */
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

const GPT3Tokenizer =
  // @ts-ignore
  typeof GPT3TokenizerImport === 'function' ? GPT3TokenizerImport : GPT3TokenizerImport.default;
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });

/**
 * @desc
 * @param {string} input
 * @returns {string[]}
 */
function encode(input: string): string[] {
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
      var _a, _b;
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
Current date: ${currentDate}${this._sepToken}

`;
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
