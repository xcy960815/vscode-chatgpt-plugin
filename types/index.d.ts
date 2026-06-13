/**
 * @desc vscode 向 webview 发送的操作事件枚举
 */
declare const WebviewMessageOptionssTypeEnums: {
  ShowInProgress: 'show-in-progress';
  AddQuestion: 'add-question';
  AddAnswer: 'add-answer';
  AddError: 'add-error';
  ClearConversation: 'clear-conversation';
  ExportConversation: 'export-conversation';
  LoadHistory: 'load-history';
  LoadConversation: 'load-conversation';
  CurrentFileData: 'current-file-data';
  SelectionData: 'selection-data';
};

/**
 * @desc vscode 向 webview 发送的操作事件类型
 */
type WebviewMessageOptionType =
  (typeof WebviewMessageOptionssTypeEnums)[keyof typeof WebviewMessageOptionssTypeEnums];

/**
 * @desc 对话历史项（传递给前端）
 */
declare interface HistoryItem {
  id: string;
  title: string;
  createdAt: number;
}

/**
 * @desc 对话消息（传递给前端渲染）
 */
declare interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * @desc vscode 向 webview 发送的操作事件选项
 */
declare interface WebviewMessageOptions {
  type: WebviewMessageOptionType;
  code?: string;
  value?: string | import('vscode').WorkspaceConfiguration;
  showConversations?: boolean;
  inProgress?: boolean;
  done?: boolean;
  showStopButton?: boolean;
  id?: string;
  autoScroll?: boolean;
  history?: HistoryItem[];
  messages?: HistoryMessage[];
  conversationId?: string;
  filename?: string;
  language?: string;
  content?: string;
  truncated?: boolean;
  isSelection?: boolean;
}

/**
 * @desc webview 向 vscode 发送事件枚举
 */
declare const OnDidReceiveMessageOptionsTypeEnums: {
  AddQuestion: 'add-question';
  InsertCode: 'insert-code';
  OpenNewTab: 'open-newtab';
  ClearConversation: 'clear-conversation';
  UpdateKey: 'update-key';
  OpenSettings: 'open-settings';
  OpenPromptSettings: 'open-prompt-settings';
  ShowConversations: 'show-conversations';
  ShowConversation: 'show-conversation';
  StopGenerating: 'stop-generating';
  LoadHistory: 'load-history';
  LoadConversation: 'load-conversation';
  DeleteConversation: 'delete-conversation';
  GetCurrentFile: 'get-current-file';
  ApplyCode: 'apply-code';
};

/**
 * @desc webview 向 vscode 发送事件类型
 */
type OnDidReceiveMessageOptionsType =
  (typeof OnDidReceiveMessageOptionsTypeEnums)[keyof typeof OnDidReceiveMessageOptionsTypeEnums];

/**
 * @desc webview 向 vscode 发送事件选项
 */
declare interface OnDidReceiveMessageOptions {
  type: OnDidReceiveMessageOptionsType;
  value?: string;
  language?: string;
  attachedContent?: string;
  attachedLanguage?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

declare interface SendApiRequestOption {
  command: string;
  code?: string;
  previousAnswer?: string;
  language?: string;
  fileName?: string;
}
