window.onload = function () {
  const vscode = acquireVsCodeApi();
  let chatgpt = {};

  marked.setOptions({
    renderer: new marked.Renderer(),
    highlight: function (code, _lang) {
      return hljs.highlightAuto(code).value;
    },
    langPrefix: 'hljs language-',
    pedantic: false,
    gfm: true,
    breaks: true,
    sanitize: false,
    smartypants: false,
    xhtml: false,
  });

  // DOM 元素引用
  const dom = {
    questionInput: document.getElementById('question-input'),
    answerList: document.getElementById('answer-list'),
    inProgress: document.getElementById('in-progress'),
    introduction: document.getElementById('introduction'),
    chatButtonWrapper: document.getElementById('chat-button-wrapper'),
    questionInputButtons: document.getElementById('question-input-buttons'),
    modelName: document.getElementById('model-name'),
    stopGeneratingButton: document.getElementById('stop-generating-button'),
    historyPanel: document.getElementById('history-panel'),
    historyList: document.getElementById('history-list'),
    historyCount: document.getElementById('history-count'),
    attachedFiles: document.getElementById('attached-files'),
    tokenBar: document.getElementById('token-bar'),
    tokenBarLabel: document.getElementById('token-bar-label'),
  };

  // 附加文件状态
  let attachedFile = null; // { filename, language, content }

  // 接收来自 vscode 的消息
  window.addEventListener('message', (event) => {
    const messageOption = event.data;
    switch (messageOption.type) {
      case 'show-in-progress':
        handleShowInProgress(messageOption);
        break;
      case 'add-question':
        handleAddQuestion(messageOption);
        break;
      case 'add-answer':
        handleAddAnswer(messageOption);
        break;
      case 'add-error':
        handleAddError(messageOption);
        break;
      case 'clear-conversation':
        handleClearConversation();
        break;
      case 'export-conversation':
        handleExportConversation();
        break;
      case 'load-history':
        handleLoadHistory(messageOption);
        break;
      case 'load-conversation':
        handleLoadConversation(messageOption);
        break;
      case 'set-chatgpt-config':
        chatgpt = messageOption.value;
        if (chatgpt.model) {
          dom.modelName.textContent = chatgpt.model;
        }
        break;
      case 'current-file-data':
        handleCurrentFileData(messageOption);
        break;
    }
  });

  const postMessageToVscode = (messageOption) => {
    vscode.postMessage(messageOption);
  };

  // HTML 转义
  const escapeHtml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe
      .toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  };

  // 模板渲染函数
  const getTemplate = (id) => {
    const template = document.getElementById(id);
    return template ? template.innerHTML : '';
  };

  // 发送问题
  const handleSendQuestion = () => {
    const text = dom.questionInput.value.trim();
    if (text.length > 0) {
      dom.historyPanel.classList.add('hidden');
      currentHistoryId = '';

      const message = {
        type: 'add-question',
        value: text,
      };

      // 如果有附加文件，将内容作为独立字段发送（用户气泡只显示原始问题）
      if (attachedFile) {
        message.attachedContent = attachedFile.content;
        message.attachedLanguage = attachedFile.language;
      }

      postMessageToVscode(message);
      dom.questionInput.value = '';
      dom.questionInput.parentNode.dataset.replicatedValue = '';
      // 发送后清除附加文件
      removeAttachedFile();
    }
  };

  // UI 状态切换：生成中
  const handleShowInProgress = (messageOption) => {
    if (messageOption.showStopButton) {
      dom.stopGeneratingButton.classList.remove('hidden');
    } else {
      dom.stopGeneratingButton.classList.add('hidden');
    }

    if (messageOption.inProgress) {
      dom.inProgress.classList.remove('hidden');
      dom.questionInput.setAttribute('disabled', 'true');
      dom.questionInputButtons.classList.add('hidden');
    } else {
      dom.inProgress.classList.add('hidden');
      dom.questionInput.removeAttribute('disabled');
      dom.questionInputButtons.classList.remove('hidden');
      dom.questionInput.focus();
    }
  };

  // 添加用户提问
  const handleAddQuestion = (messageOption) => {
    dom.answerList.classList.remove('hidden');
    dom.introduction?.classList?.add('hidden');

    const msgContainer = document.createElement('div');
    msgContainer.className = 'msg-container msg-user question-element';
    msgContainer.innerHTML = `
      <div class="msg-header">
        ${getTemplate('tpl-user-icon')}
        You
      </div>
      <no-export class="edit-actions">
        <button data-action="edit-question" class="edit-btn" title="Edit">
          ${getTemplate('tpl-edit-icon')}
        </button>
        <div class="send-cancel-container hidden flex gap-2">
          <button data-action="send-edited" class="edit-btn" title="Send">
            ${getTemplate('tpl-send-icon')} Send
          </button>
          <button data-action="cancel-edit" class="edit-btn" title="Cancel">
            Cancel
          </button>
        </div>
      </no-export>
      <div class="msg-content question-content">${escapeHtml(messageOption.value)}</div>
    `;

    dom.answerList.appendChild(msgContainer);
    scrollToBottom(messageOption.autoScroll);
  };

  // 添加 AI 回答
  const handleAddAnswer = (messageOption) => {
    let existingMessageElement = messageOption.id ? document.getElementById(messageOption.id) : null;
    
    // 自动补全代码块闭合标签，防止解析错误
    const updatedValue = messageOption.value.split('```').length % 2 === 1
        ? messageOption.value
        : messageOption.value + '\n\n```\n\n';

    const markedResponse = marked.parse(updatedValue);

    if (existingMessageElement) {
      existingMessageElement.innerHTML = markedResponse;
    } else {
      const msgContainer = document.createElement('div');
      msgContainer.className = 'msg-container msg-ai answer-element';
      msgContainer.innerHTML = `
        <div class="msg-header">
          ${getTemplate('tpl-ai-icon')}
          ChatGPT
        </div>
        <div class="msg-content result-streaming" id="${messageOption.id || ''}">${markedResponse}</div>
      `;
      dom.answerList.appendChild(msgContainer);
    }

    if (messageOption.done) {
      const currentAnswer = dom.answerList.lastElementChild;
      if (currentAnswer) {
        const streamingContent = currentAnswer.querySelector('.result-streaming');
        if (streamingContent) {
          streamingContent.classList.remove('result-streaming');
        }
        processCodeBlocks(currentAnswer);
      }
    }

    if (messageOption.done || markedResponse.endsWith('\n')) {
      scrollToBottom(messageOption.autoScroll);
    }
  };

  // 添加错误消息
  const handleAddError = (messageOption) => {
    if (dom.introduction && !dom.introduction.classList.contains('hidden')) {
      dom.introduction.classList.add('hidden');
      dom.answerList.classList.remove('hidden');
    }

    const msgContainer = document.createElement('div');
    msgContainer.className = 'msg-container msg-error error-element-ext';
    msgContainer.innerHTML = `
      <div class="msg-header">
        ${getTemplate('tpl-error-icon')}
        Error
      </div>
      <div class="msg-content">${marked.parse(messageOption.value)}</div>
    `;

    dom.answerList.appendChild(msgContainer);
    scrollToBottom(messageOption.autoScroll);
  };

  // 处理代码块，添加操作按钮
  const processCodeBlocks = (container) => {
    const preElements = container.querySelectorAll('pre');
    preElements.forEach((pre) => {
      // 避免重复添加
      if (pre.parentNode.classList.contains('code-wrapper')) return;

      const codeElem = pre.querySelector('code');
      const langMatch = codeElem ? codeElem.className.match(/language-(\w+)/) : null;
      const lang = langMatch ? langMatch[1] : 'code';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);
      
      const header = document.createElement('no-export');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${lang}</span>
        <div class="code-actions">
          <button data-action="copy-code" title="Copy code">${getTemplate('tpl-copy-icon')} Copy</button>
          <button data-action="insert-code" title="Insert into editor">${getTemplate('tpl-insert-icon')} Insert</button>
          <button data-action="new-tab-code" title="Open in new tab">${getTemplate('tpl-new-tab-icon')} New Tab</button>
        </div>
      `;
      
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  };

  const scrollToBottom = (autoScroll) => {
    if (autoScroll) {
      dom.answerList.lastElementChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }
  };

  const handleClearConversation = () => {
    dom.answerList.innerHTML = '';
    dom.answerList.classList.add('hidden');
    dom.introduction?.classList?.remove('hidden');
    dom.historyPanel.classList.add('hidden');
    currentHistoryId = '';
    postMessageToVscode({ type: 'clear-conversation' });
  };

  const handleExportConversation = () => {
    const turndownService = new TurndownService({ codeBlockStyle: 'fenced' });
    turndownService.remove('no-export');
    const markdownContent = turndownService.turndown(dom.answerList);
    postMessageToVscode({
      type: 'open-newtab',
      value: markdownContent,
      language: 'markdown',
    });
  };

  // --- 历史对话管理 ---
  let currentHistoryId = '';

  const handleLoadHistory = (messageOption) => {
    const history = messageOption.history || [];
    dom.historyCount.textContent = history.length > 0 ? `(${history.length})` : '';

    if (history.length === 0) {
      dom.historyList.innerHTML = `<div class="history-empty">${dom.historyList.dataset.emptyText || 'No history'}</div>`;
    } else {
      dom.historyList.innerHTML = history.map(item => {
        const date = new Date(item.createdAt);
        const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const activeClass = item.id === currentHistoryId ? ' active' : '';
        return `
          <div class="history-item${activeClass}" data-conversation-id="${item.id}">
            <span class="history-item-title">${escapeHtml(item.title)}</span>
            <span class="history-item-time">${timeStr}</span>
            <button data-action="delete-history" data-id="${item.id}" class="history-item-delete" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        `;
      }).join('');
    }
  };

  const handleLoadConversation = (messageOption) => {
    const messages = messageOption.messages || [];
    currentHistoryId = messageOption.conversationId || '';

    // 清空当前显示
    dom.answerList.innerHTML = '';
    dom.answerList.classList.remove('hidden');
    dom.introduction?.classList?.add('hidden');
    dom.historyPanel.classList.add('hidden');

    // 渲染历史消息
    messages.forEach(msg => {
      if (msg.role === 'user') {
        const msgContainer = document.createElement('div');
        msgContainer.className = 'msg-container msg-user question-element';
        msgContainer.innerHTML = `
          <div class="msg-header">
            ${getTemplate('tpl-user-icon')}
            You
          </div>
          <div class="msg-content question-content">${escapeHtml(msg.content)}</div>
        `;
        dom.answerList.appendChild(msgContainer);
      } else if (msg.role === 'assistant') {
        const msgContainer = document.createElement('div');
        msgContainer.className = 'msg-container msg-ai answer-element';
        const markedResponse = marked.parse(msg.content);
        msgContainer.innerHTML = `
          <div class="msg-header">
            ${getTemplate('tpl-ai-icon')}
            ChatGPT
          </div>
          <div class="msg-content">${markedResponse}</div>
        `;
        dom.answerList.appendChild(msgContainer);
        processCodeBlocks(msgContainer);
      }
    });
  };

  const toggleHistoryPanel = () => {
    const isVisible = !dom.historyPanel.classList.contains('hidden');
    if (isVisible) {
      dom.historyPanel.classList.add('hidden');
    } else {
      dom.historyPanel.classList.remove('hidden');
      // 请求最新的历史列表
      postMessageToVscode({ type: 'load-history' });
    }
  };

  // --- 附加文件处理 ---
  const handleCurrentFileData = (messageOption) => {
    const { filename, language, content, truncated } = messageOption;
    if (!filename) {
      return;
    }
    attachedFile = { filename, language, content };
    showAttachedChip(filename, language, truncated);
  };

  const showAttachedChip = (filename, language, truncated) => {
    dom.attachedFiles.innerHTML = '';
    dom.attachedFiles.classList.remove('hidden');

    const chip = document.createElement('span');
    chip.className = 'file-chip';
    const truncBadge = truncated
      ? '<span class="file-chip-truncated" title="File was truncated (too large)">⚠ truncated</span>'
      : '';
    chip.innerHTML = `
      <span class="file-chip-icon">📎</span>
      <span class="file-chip-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
      <span class="file-chip-lang">(${escapeHtml(language)})</span>
      ${truncBadge}
      <button data-action="remove-attached-file" class="file-chip-remove" title="Remove">&times;</button>
    `;
    dom.attachedFiles.appendChild(chip);
  };

  const removeAttachedFile = () => {
    attachedFile = null;
    dom.attachedFiles.innerHTML = '';
    dom.attachedFiles.classList.add('hidden');
  };

  // --- Token 估算进度条 ---
  const MAX_CONTEXT_TOKENS = 128000; // 粗略按 GPT-4o 上下文估算
  const updateTokenBar = () => {
    const text = dom.questionInput.value;
    // 用户当前输入 + 附加文件（用于决定是否显示标签）
    const userChars = text.length + (attachedFile ? attachedFile.content.length + attachedFile.language.length + 10 : 0);

    // 历史对话也占 context window
    let historyChars = 0;
    const historyMsgs = dom.answerList.querySelectorAll('.msg-content');
    historyMsgs.forEach((el) => {
      historyChars += (el.textContent || '').length;
    });

    const totalChars = userChars + historyChars;
    const estimatedTokens = Math.ceil(totalChars / 4);
    const pct = Math.min((estimatedTokens / MAX_CONTEXT_TOKENS) * 100, 100);

    // 进度条始终反映总 context 占用
    dom.tokenBar.style.width = pct > 0 ? `${Math.max(pct, 0.5)}%` : '0%';
    dom.tokenBar.classList.remove('token-bar-warning');
    if (pct >= 80) {
      dom.tokenBar.classList.add('token-bar-warning');
    }

    // 标签只在用户有实际输入或附加文件时显示
    if (userChars > 0) {
      dom.tokenBarLabel.textContent = `~${estimatedTokens.toLocaleString()} tokens`;
      dom.tokenBarLabel.classList.remove('hidden');
    } else {
      dom.tokenBarLabel.classList.add('hidden');
    }
  };

  // --- 事件分发处理 ---
  const ACTION_HANDLERS = {
    'send-question': () => handleSendQuestion(),
    'attach-current-file': () => {
      postMessageToVscode({ type: 'get-current-file' });
    },
    'remove-attached-file': () => {
      removeAttachedFile();
      updateTokenBar();
    },
    'toggle-more': () => {
      dom.chatButtonWrapper?.classList.toggle('hidden');
    },
    'open-settings': () => postMessageToVscode({ type: 'open-settings' }),
    'open-prompt-settings': () => postMessageToVscode({ type: 'open-prompt-settings' }),
    'update-key': () => postMessageToVscode({ type: 'update-key' }),
    'clear-conversation': () => handleClearConversation(),
    'export-conversation': () => handleExportConversation(),
    'stop-generating': () => postMessageToVscode({ type: 'stop-generating' }),
    'toggle-history': () => toggleHistoryPanel(),
    'delete-history': (target) => {
      const id = target.getAttribute('data-id');
      if (id) {
        postMessageToVscode({ type: 'delete-conversation', value: id });
      }
    },
    
    // 消息内操作
    'edit-question': (target) => {
      const container = target.closest('.question-element');
      const content = container.querySelector('.question-content');
      const editBtn = container.querySelector('[data-action="edit-question"]');
      const actionGroup = container.querySelector('.send-cancel-container');
      
      content.setAttribute('contenteditable', 'true');
      content.focus();
      editBtn.classList.add('hidden');
      actionGroup.classList.remove('hidden');
      actionGroup.classList.add('flex');
    },
    'send-edited': (target) => {
      const container = target.closest('.question-element');
      const content = container.querySelector('.question-content');
      const text = content.textContent.trim();
      
      if (text.length > 0) {
        postMessageToVscode({ type: 'add-question', value: text });
      }
      
      // 恢复状态
      content.setAttribute('contenteditable', 'false');
      container.querySelector('[data-action="edit-question"]').classList.remove('hidden');
      container.querySelector('.send-cancel-container').classList.add('hidden');
      container.querySelector('.send-cancel-container').classList.remove('flex');
    },
    'cancel-edit': (target) => {
      const container = target.closest('.question-element');
      const content = container.querySelector('.question-content');
      
      content.setAttribute('contenteditable', 'false');
      container.querySelector('[data-action="edit-question"]').classList.remove('hidden');
      container.querySelector('.send-cancel-container').classList.add('hidden');
      container.querySelector('.send-cancel-container').classList.remove('flex');
    },
    
    // 代码块操作
    'copy-code': (target) => {
      const codeBlock = target.closest('.code-wrapper').querySelector('pre code');
      navigator.clipboard.writeText(codeBlock.textContent).then(() => {
        const originalHtml = target.innerHTML;
        target.innerHTML = `${getTemplate('tpl-copied-icon')} Copied`;
        setTimeout(() => {
          target.innerHTML = originalHtml;
        }, 1500);
      });
    },
    'insert-code': (target) => {
      const codeBlock = target.closest('.code-wrapper').querySelector('pre code');
      postMessageToVscode({ type: 'insert-code', value: codeBlock.textContent });
    },
    'new-tab-code': (target) => {
      const codeBlock = target.closest('.code-wrapper').querySelector('pre code');
      postMessageToVscode({ type: 'open-newtab', value: codeBlock.textContent });
    }
  };

  // 全局点击事件委托
  document.addEventListener('click', (e) => {
    // 处理 a 标签
    if (e.target.tagName.toLowerCase() === 'a' && e.target.getAttribute('href') === '#') {
      e.preventDefault();
    }

    const actionElement = e.target.closest('[data-action]');
    if (actionElement) {
      e.preventDefault();
      const action = actionElement.getAttribute('data-action');
      if (ACTION_HANDLERS[action]) {
        ACTION_HANDLERS[action](actionElement);
      }
    }

    // 点击历史项加载对话
    const historyItem = e.target.closest('.history-item');
    if (historyItem && !e.target.closest('[data-action="delete-history"]')) {
      const id = historyItem.getAttribute('data-conversation-id');
      if (id) {
        postMessageToVscode({ type: 'load-conversation', value: id });
      }
    }

    // 点击其他区域关闭更多菜单
    if (!e.target.closest('#chat-button-wrapper') && !e.target.closest('[data-action="toggle-more"]')) {
      dom.chatButtonWrapper?.classList.add('hidden');
    }
  });

  // 输入框事件
  dom.questionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      handleSendQuestion();
    }
  });

  // Token 进度条实时更新
  dom.questionInput.addEventListener('input', () => {
    updateTokenBar();
  });
};
