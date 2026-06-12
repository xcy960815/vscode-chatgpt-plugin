import * as vscode from 'vscode';

export class ConfigManager {
  private static _instance: ConfigManager;
  private _context!: vscode.ExtensionContext;

  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager._instance) {
      ConfigManager._instance = new ConfigManager();
    }
    return ConfigManager._instance;
  }

  public init(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  private get chatGptConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('chatgpt');
  }

  public get apiKey(): string {
    const globalState = this._context.globalState;
    return (
      globalState.get<string>('chatgpt-gpt-apiKey') ||
      this.chatGptConfig.get<string>('gpt.apiKey') ||
      ''
    );
  }

  public async setApiKey(key: string): Promise<void> {
    // 优先存储在全局状态中
    await this._context.globalState.update('chatgpt-gpt-apiKey', key);

    // 如果配置里原本就有设置，则同步更新配置保持一致
    const configHasKey = this.chatGptConfig.get<string>('gpt.apiKey');
    if (configHasKey !== undefined && configHasKey !== '') {
      await vscode.workspace
        .getConfiguration('chatgpt')
        .update('gpt.apiKey', key, vscode.ConfigurationTarget.Global);
    }
  }

  public clearApiKey(): void {
    this._context.globalState.update('chatgpt-gpt-apiKey', null);
  }

  public get model(): string {
    return (
      this.chatGptConfig.get<string>('gpt.customModel') ||
      this.chatGptConfig.get<string>('gpt.model') ||
      ''
    );
  }

  public get autoScroll(): boolean {
    return this.chatGptConfig.get<boolean>('response.autoScroll') || false;
  }

  public get subscribeToResponse(): boolean {
    return this.chatGptConfig.get<boolean>('response.subscribeToResponse') || false;
  }

  public get organization(): string {
    return this.chatGptConfig.get<string>('gpt.organization') || '';
  }

  public get maxTokens(): number {
    return this.chatGptConfig.get<number>('gpt.maxTokens') || 4096;
  }

  public get temperature(): number {
    return this.chatGptConfig.get<number>('gpt.temperature') || 0.2;
  }

  public get reasoningEffort(): 'low' | 'medium' | 'high' {
    return this.chatGptConfig.get<'low' | 'medium' | 'high'>('gpt.reasoningEffort') || 'medium';
  }

  public get apiBaseUrl(): string {
    return this.chatGptConfig.get<string>('gpt.apiBaseUrl')?.trim() || '';
  }

  public get systemMessage(): string {
    return this.chatGptConfig.get<string>('gpt.systemMessage') || '';
  }

  public getPromptPrefix(command: string): string | undefined {
    return this.chatGptConfig.get<string>(`promptPrefix.${command}`);
  }

  public async setPromptPrefix(command: string, value: string): Promise<void> {
    await this.chatGptConfig.update(`promptPrefix.${command}`, value, true);
  }

  public getPromptPrefixEnabled(command: string): boolean {
    return this.chatGptConfig.get<boolean>(`promptPrefix.${command}-enabled`) || false;
  }

  public get adhocPrompt(): string {
    return this._context.globalState.get<string>('chatgpt-adhoc-prompt') || '';
  }

  public setAdhocPrompt(prompt: string): void {
    this._context.globalState.update('chatgpt-adhoc-prompt', prompt);
  }
}

export const configManager = ConfigManager.getInstance();
