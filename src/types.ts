/* eslint-disable @typescript-eslint/naming-convention */
// Adapted from https://github.com/transitive-bullshit/chatgpt-api/blob/v3/license

export type ContentType = 'text';

export type Role = 'user' | 'assistant';

/**
 * https://chat.openapi.com/api/auth/session
 */
export type SessionResult = {
  /**
   * Authenticated user
   */
  user: User;

  /**
   * ISO date of the expiration date of the access token
   */
  expires: string;

  /**
   * The access token
   */
  accessToken: string;

  /**
   * If there was an error associated with this request
   */
  error?: string | null;
};

export type User = {
  /**
   * ID of the user
   */
  id: string;

  /**
   * Name of the user
   */
  name: string;

  /**
   * Email of the user
   */
  email?: string;

  /**
   * Image of the user
   */
  image: string;

  /**
   * Picture of the user
   */
  picture: string;

  /**
   * Groups the user is in
   */
  groups: string[];

  /**
   * Features the user is in
   */
  features: string[];
};

export type Model = {
  /**
   * Name of the model
   */
  slug: string;

  /**
   * Max tokens of the model
   */
  max_tokens: number;

  /**
   * Whether or not the model is special
   */
  is_special: boolean;
};

/**
 * https://chat.openapi.com/backend-api/moderations
 */
export type ModerationsJSONBody = {
  /**
   * Input for the moderation decision
   */
  input: string;

  /**
   * The model to use in the decision
   */
  model: AvailableModerationModels;
};

export type AvailableModerationModels = 'text-moderation-playground';

/**
 * https://chat.openapi.com/backend-api/conversation
 */
export type ConversationJSONBody = {
  /**
   * The action to take
   */
  action: string;

  /**
   * The ID of the conversation
   */
  conversation_id?: string;

  /**
   * Prompts to provide
   */
  messages: Prompt[];

  /**
   * The model to use
   */
  model: string;

  /**
   * The parent message ID
   */
  parent_message_id: string;
};

export type Prompt = {
  /**
   * The content of the prompt
   */
  content: PromptContent;

  /**
   * The ID of the prompt
   */
  id: string;

  /**
   * The role played in the prompt
   */
  role: Role;
};

export type PromptContent = {
  /**
   * The content type of the prompt
   */
  content_type: ContentType;

  /**
   * The parts to the prompt
   */
  parts: string[];
};

/**
 * https://chat.openapi.com/backend-api/conversation/message_feedback
 */
export type MessageFeedbackJSONBody = {
  /**
   * The ID of the conversation
   */
  conversation_id: string;

  /**
   * The message ID
   */
  message_id: string;

  /**
   * The rating
   */
  rating: MessageFeedbackRating;

  /**
   * Tags to give the rating
   */
  tags?: MessageFeedbackTags[];

  /**
   * The text to include
   */
  text?: string;
};

export type MessageFeedbackTags = 'harmful' | 'false' | 'not-helpful';

export type MessageFeedbackResult = {
  /**
   * The message ID
   */
  message_id: string;

  /**
   * The ID of the conversation
   */
  conversation_id: string;

  /**
   * The ID of the user
   */
  user_id: string;

  /**
   * The rating
   */
  rating: MessageFeedbackRating;

  /**
   * The text the server received, including tags
   */
  text?: string;
};

export type MessageFeedbackRating = 'thumbsUp' | 'thumbsDown';

export type ConversationResponseEvent = {
  message?: Message;
  conversation_id?: string;
  error?: string | null;
};

export type Author = {
  role: 'user' | 'assistant' | 'system';
  name: null;
  metadata: MessageMetadata;
};

export type Message = {
  id: string;
  content: MessageContent;
  role?: string;
  user?: string | null;
  create_time: string | number;
  update_time: string | null;
  end_turn: boolean | null;
  author: Author;
  weight: number;
  recipient: string;
  metadata: MessageMetadata;
};

export type MessageContent = {
  content_type: 'text';
  parts: string[];
};

export type MessageMetadata = any;
export type MessageActionType = 'next' | 'variant';

export type SendMessageOptions = {
  conversationId?: string;
  parentMessageId?: string;
  messageId?: string;
  action?: MessageActionType;
  timeoutMs?: number;
  onProgress?: (partialResponse: ChatResponse) => void;
  abortSignal: AbortSignal;
  model?: string;
};

export type SendConversationMessageOptions = Omit<
  SendMessageOptions,
  'conversationId' | 'parentMessageId'
>;

export class ChatGPTError extends Error {
  statusCode?: number;
  statusText?: string;
  response?: Response;
  originalError?: Error;
}

export type ChatError = {
  error: { message: string; statusCode?: number; statusText?: string };
  conversationId?: string;
  messageId?: string;
};

export type ChatResponse = {
  response: string;
  conversationId: string;
  messageId: string;
  origMessageId: string;
};

export type ConversationsItem = {
  create_time: string;
  id: string;
  title: string;
};

export type ConversationsResponse = {
  items: ConversationsItem[];
  total: number;
  limit: number;
  offset: number;
};

export type ConversationItem = {
  id: string;
  message: Message | null;
  parent: string | null;
  children: string[];
};

export type ConversationResponse = {
  title: string;
  mapping: Record<string, ConversationItem>;
  create_time: number;
  moderation_results: any[];
  current_node: string;
};

export type LoginMethod = 'GPT3 OpenAI API Key';

export type AuthType =
  | 'OpenAI Authentication'
  | 'Google Authentication'
  | 'Microsoft Authentication';

export interface MessageOption {
  type:
    | 'show-in-progress'
    | 'login-successful'
    | 'add-answer'
    | 'add-question'
    | 'add-error'
    | 'clear-conversation'
    | 'export-conversation-to-markdown'
    | 'set-current-language'
    | 'set-locales';
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

export type LeftOverMessage = MessageOption | null;

export interface Locales {
  [key: string]: {
    [key: string]: string;
  };
}
