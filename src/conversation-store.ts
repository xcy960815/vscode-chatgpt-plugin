import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

const STORAGE_KEY = 'chatgpt-conversations';
const MAX_CONVERSATIONS = 20;
const MAX_TITLE_LENGTH = 30;

export class ConversationStore {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** 获取所有对话历史（按时间倒序） */
  public getAll(): Conversation[] {
    const data = this.context.globalState.get<Conversation[]>(STORAGE_KEY, []);
    return data.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 根据 id 获取单个对话 */
  public getById(id: string): Conversation | undefined {
    const all = this.getAll();
    return all.find((c) => c.id === id);
  }

  /** 保存对话（新增或更新） */
  public async save(conversation: Conversation): Promise<void> {
    const all = this.getAll();

    // 生成标题：取第一条用户消息的前 30 个字
    if (!conversation.title && conversation.messages.length > 0) {
      const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        conversation.title =
          firstUserMsg.content.length > MAX_TITLE_LENGTH
            ? firstUserMsg.content.substring(0, MAX_TITLE_LENGTH) + '...'
            : firstUserMsg.content;
      }
    }

    // 如果已存在则更新，否则新增
    const existingIndex = all.findIndex((c) => c.id === conversation.id);
    if (existingIndex >= 0) {
      all[existingIndex] = conversation;
    } else {
      all.unshift(conversation);
    }

    // 限制数量，超过则删除最旧的
    const trimmed = all.slice(0, MAX_CONVERSATIONS);

    await this.context.globalState.update(STORAGE_KEY, trimmed);
  }

  /** 删除指定对话 */
  public async delete(id: string): Promise<void> {
    const all = this.getAll();
    const filtered = all.filter((c) => c.id !== id);
    await this.context.globalState.update(STORAGE_KEY, filtered);
  }

  /** 清空所有对话 */
  public async clearAll(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, []);
  }
}
