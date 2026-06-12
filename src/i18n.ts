import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export class I18n {
  private static _instance: I18n;
  private _languageDict: Record<string, string> = {};

  private constructor() {}

  public static getInstance(): I18n {
    if (!I18n._instance) {
      I18n._instance = new I18n();
    }
    return I18n._instance;
  }

  public init(context: vscode.ExtensionContext): void {
    const language = vscode.env.language;
    let languageFilePath: string;

    if (language === 'zh-cn') {
      languageFilePath = path.join(context.extensionPath, './', 'package.nls.zh-cn.json');
      if (!fs.existsSync(languageFilePath)) {
        languageFilePath = path.join(context.extensionPath, './', 'package.nls.json');
      }
    } else {
      languageFilePath = path.join(context.extensionPath, './', 'package.nls.json');
    }

    try {
      const json = fs.readFileSync(languageFilePath, 'utf-8');
      this._languageDict = JSON.parse(json);
    } catch (error) {
      console.error(`Failed to load language file from ${languageFilePath}`, error);
      this._languageDict = {};
    }
  }

  public t(key: string): string {
    return this._languageDict[key] || key;
  }

  public get dict(): Record<string, string> {
    return this._languageDict;
  }
}

export const i18n = I18n.getInstance();
