/**
 * @desc 回话前准备
 * @param {boolean} modelChanged
 * @returns {Promise<boolean>}
 */
// public async prepareConversation1(modelChanged?: boolean): Promise<boolean> {
//   if (modelChanged && this.useAutoLogin) {
//     return false;
//   }
//   if (this.useGpt3) {
//     if (
//       (this.isGpt35Model && !this.apiGpt35) ||
//       (!this.isGpt35Model && !this.apiGpt3) ||
//       modelChanged
//     ) {
//       // 全局状态
//       const globalState = this.context.globalState;
//       let chatgptApiKey =
//         this.chatGptConfig.get<string>('gpt3.apiKey') ||
//         globalState.get<string>('chatgpt-gpt3-apiKey');
//       const organization = this.chatGptConfig.get<string>('gpt3.organization');
//       const max_tokens = this.chatGptConfig.get<number>('gpt3.maxTokens');
//       const temperature = this.chatGptConfig.get<number>('gpt3.temperature');
//       const top_p = this.chatGptConfig.get<number>('gpt3.top_p');
//       const apiBaseUrl = this.chatGptConfig.get<string>('gpt3.apiBaseUrl');
//       const noApiKeyMessage = this.chatGptConfig.get<string>('pageMessage.noApiKey.message')!;
//       const choose1 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose1')!;
//       const choose2 = this.chatGptConfig.get<string>('pageMessage.noApiKey.choose2')!;
//       // 检查apiKey是否存在
//       if (!chatgptApiKey) {
//         // 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
//         await vscode.window
//           .showErrorMessage(noApiKeyMessage, choose1, choose2)
//           .then(async (choice) => {
//             // 如果用户选择了打开设置
//             if (choice === choose2) {
//               // 打开 关于openai apiKey的设置项
//               vscode.commands.executeCommand(
//                 'workbench.action.openSettings',
//                 'chatgpt.gpt3.apiKey',
//               );
//               return false;
//             } else if (choice === choose1) {
//               const title = this.chatGptConfig.get<string>(
//                 'pageMessage.noApiKey.inputBox.title',
//               )!;
//               const prompt = this.chatGptConfig.get<string>(
//                 'pageMessage.noApiKey.inputBox.prompt',
//               )!;
//               const placeHolder = this.chatGptConfig.get<string>(
//                 'pageMessage.noApiKey.inputBox.placeHolder',
//               )!;
//               // 如果用户选择了存储在会话中
//               await vscode.window
//                 .showInputBox({
//                   title,
//                   prompt,
//                   ignoreFocusOut: true,
//                   placeHolder,
//                   value: chatgptApiKey || '',
//                 })
//                 .then((value) => {
//                   if (value) {
//                     chatgptApiKey = value.trim();
//                     // 存储在全局状态中
//                     globalState.update('chatgpt-gpt3-apiKey', chatgptApiKey);
//                     this.sendMessage(
//                       { type: 'login-successful', showConversations: this.useAutoLogin },
//                       true,
//                     );
//                   }
//                 });
//             }
//           });

//         return false;
//       }

//       // 初始化 chatgpt 模型
//       if (this.isGpt35Model) {
//         this.apiGpt35 = new ChatGPTAPI35({
//           apiKey: chatgptApiKey,
//           fetch: fetch,
//           apiBaseUrl: apiBaseUrl?.trim(),
//           organization,
//           completionParams: {
//             model: this.model,
//             max_tokens,
//             temperature,
//             top_p,
//           },
//         });
//       } else {
//         this.apiGpt3 = new ChatGPTAPI3({
//           apiKey: chatgptApiKey,
//           fetch: fetch,
//           apiBaseUrl: apiBaseUrl?.trim(),
//           organization,
//           completionParams: {
//             model: this.model,
//             max_tokens,
//             temperature,
//             top_p,
//           },
//         });
//       }
//     }
//   }

//   this.sendMessage({ type: 'login-successful', showConversations: this.useAutoLogin }, true);

//   return true;
// }
