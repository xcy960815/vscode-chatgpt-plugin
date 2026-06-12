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
    stopGeneratingButton: document.getElementById('stop-generating-button')
  };

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
      case 'set-chatgpt-config':
        chatgpt = messageOption.value;
        if (chatgpt.model) {
          dom.modelName.textContent = chatgpt.model;
        }
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
      postMessageToVscode({
        type: 'add-question',
        value: text,
      });
      dom.questionInput.value = '';
      dom.questionInput.parentNode.dataset.replicatedValue = '';
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

  // --- 事件分发处理 ---
  const ACTION_HANDLERS = {
    'send-question': () => handleSendQuestion(),
    'toggle-more': () => {
      dom.chatButtonWrapper?.classList.toggle('hidden');
    },
    'open-settings': () => postMessageToVscode({ type: 'open-settings' }),
    'open-prompt-settings': () => postMessageToVscode({ type: 'open-prompt-settings' }),
    'update-key': () => postMessageToVscode({ type: 'update-key' }),
    'clear-conversation': () => handleClearConversation(),
    'export-conversation': () => handleExportConversation(),
    'stop-generating': () => postMessageToVscode({ type: 'stop-generating' }),
    
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
};
