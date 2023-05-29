/* eslint-disable @typescript-eslint/naming-convention */
import fetch from 'isomorphic-fetch';
export type Fetch = typeof fetch;
export type LoginMethod = 'GPT3 OpenAI API Key' | undefined;

export interface FetchSSEOptions extends RequestInit {
  onMessage?: (message: string) => void;
}

export type AuthType =
  | 'OpenAI Authentication'
  | 'Google Authentication'
  | 'Microsoft Authentication';

export interface WebviewMessageOption {
  type:
    | 'show-in-progress'
    | 'login-successful'
    | 'add-answer'
    | 'add-question'
    | 'add-error'
    | 'clear-conversation'
    | 'set-chatgpt-config'
    | 'export-conversation';
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

export interface OnDidReceiveMessageOption {
  type:
    | 'add-question'
    | 'insert-code'
    | 'open-new-tab'
    | 'clear-gpt3'
    | 'clear-conversation'
    | 'login'
    | 'open-settings'
    | 'open-prompt-settings'
    | 'show-conversations'
    | 'show-conversation'
    | 'stop-generating'
    | 'get-chatgpt-config';
  value?: string;
  language?: string;
}

export interface SendApiRequestOption {
  command: string;
  code?: string;
  previousAnswer?: string;
  language?: string;
}
