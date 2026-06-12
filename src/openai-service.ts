import OpenAI from 'openai';
import { configManager } from './config';

export interface SendMessageOptions {
  systemMessage?: string;
  onProgress?: (text: string) => void;
  abortSignal?: AbortSignal;
}

export class OpenAIService {
  private openai: OpenAI;
  private messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  constructor() {
    this.openai = new OpenAI({
      apiKey: configManager.apiKey,
      baseURL: configManager.apiBaseUrl || undefined,
      organization: configManager.organization || undefined,
    });
  }

  public clearSession() {
    this.messages = [];
  }

  public async sendMessage(prompt: string, options: SendMessageOptions): Promise<string> {
    if (this.messages.length === 0 && options.systemMessage) {
      this.messages.push({ role: 'system', content: options.systemMessage });
    }

    this.messages.push({ role: 'user', content: prompt });

    try {
      const model = configManager.model || 'gpt-3.5-turbo';
      const isReasoningModel = /^o\d/i.test(model);

      const createParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model,
        messages: this.messages,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        max_tokens: configManager.maxTokens,
        stream: true,
      };

      // o 系列推理模型不支持自定义 temperature，只支持 reasoning_effort
      if (isReasoningModel) {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        createParams.reasoning_effort = configManager.reasoningEffort;
      } else {
        createParams.temperature = configManager.temperature;
      }

      const stream = await this.openai.chat.completions.create(createParams, {
        signal: options.abortSignal,
      });

      let fullResponse = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        fullResponse += delta;
        if (options.onProgress) {
          options.onProgress(fullResponse);
        }
      }

      this.messages.push({ role: 'assistant', content: fullResponse });
      return fullResponse;
    } catch (error: any) {
      // Remove the latest user message if the request failed
      this.messages.pop();
      throw error;
    }
  }
}
