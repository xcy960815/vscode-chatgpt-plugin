// Adapted from https://github.com/transitive-bullshit/chatgpt-api/blob/v3/license

import {
  ChatResponse,
  ConversationResponse,
  ConversationsResponse,
  SendMessageOptions,
} from './types';

export abstract class AChatGPTAPI {
  abstract initSession(): Promise<void>;

  abstract sendMessage(message: string, opts?: SendMessageOptions): Promise<ChatResponse>;

  abstract getIsAuthenticated(): Promise<boolean>;

  abstract refreshSession(): Promise<any>;

  async resetSession(): Promise<any> {
    await this.closeSession();
    return this.initSession();
  }

  abstract closeSession(): Promise<void>;

  abstract getConversations(
    offset?: number,
    limit?: number,
  ): Promise<ConversationsResponse | undefined>;

  abstract getConversation(id: string): Promise<ConversationResponse | undefined>;
}
