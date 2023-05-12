/* eslint-disable @typescript-eslint/naming-convention */
export type LoginMethod = 'GPT3 OpenAI API Key';

export type AuthType =
  | 'OpenAI Authentication'
  | 'Google Authentication'
  | 'Microsoft Authentication';

export interface SendMessageOption {
  type:
    | 'show-in-progress'
    | 'login-successful'
    | 'add-answer'
    | 'add-question'
    | 'add-error'
    | 'clear-conversation'
    | 'set-chatgpt-config'
    | 'export-conversation-to-markdown';
  code?: string;
  value?: any;
  showConversations?: boolean;
  inProgress?: boolean;
  done?: boolean;
  showStopButton?: boolean;
  id?: string;
  autoScroll?: boolean;
  responseInMarkdown?: boolean;
}

export interface SendApiRequestOption {
  command: string;
  code?: string;
  previousAnswer?: string;
  language?: string;
}

export type LeftOverMessage = SendMessageOption | null;
