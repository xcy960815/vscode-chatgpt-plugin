import OpenAI from 'openai';
import { configManager } from './config';
import { ChatMessage } from './conversation-store';

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

  /** 获取当前对话中的 user/assistant 消息（不含 system） */
  public getConversationMessages(): ChatMessage[] {
    return this.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
  }

  /** 从历史记录中恢复对话上下文 */
  public loadConversation(chatMessages: ChatMessage[], systemMessage?: string) {
    this.messages = [];
    if (systemMessage) {
      this.messages.push({ role: 'system', content: systemMessage });
    }
    for (const msg of chatMessages) {
      this.messages.push({ role: msg.role, content: msg.content });
    }
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
