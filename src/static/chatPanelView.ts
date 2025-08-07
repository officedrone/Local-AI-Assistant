import * as vscode from 'vscode';
const CONFIG_SECTION = 'localAIAssistant';

export function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
): string {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('includeFileContext', true);

  const maxTokens = vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<number>('maxTokens', 4096);


  const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'styles.css')
  );
  const mdItUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'markdown-it.min.js')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>AI Chat</title>
  <link href="${styleUri}" rel="stylesheet"/>
</head>
<body>
  <div id="session-controls" style="display: flex; justify-content: space-between; gap: 8px; margin: 8px;">
    <button id="newSessionButton" style="flex: 1;">New Session</button>
    <button id="settingsButton" title="Settings" style="flex: 1;">⚙️</button>
  </div>

  <button id="scrollToBottomButton" title="Scroll to bottom">↓</button>
  <div id="chat-container"></div>

  <div class="input-wrapper">
    <textarea id="messageInput" placeholder="Type your message…" rows="3"></textarea>
    <div class="button-stack">
      <button id="sendButton">Send</button>
    </div>
  </div>

  <div id="fileContextContainer">
    <label for="contextCheckbox" style="display: flex; align-items: center; gap: 8px;">
      <input
        type="checkbox"
        id="contextCheckbox"
        ${includeCtx ? 'checked' : ''}
      />
      <span>Include current file in context</span>
      <span
        id="contextTokenCount"
        style="font-size: 0.9em; color: #888; margin-left: 4px;"
      ></span>
    </label>
  </div>

  <div id="sessionTokenContainer">
    Chat Tokens: <span id="sessionTokenCount">0</span><br>
    File Context Tokens: <span id="fileTokenCount">0</span><br>
    Total Tokens: <span id="totalTokenCount">0</span> of ${maxTokens} tokens


  </div>

  <script src="${mdItUri}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat-container');
    const scrollBtn = document.getElementById('scrollToBottomButton');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');
    const settingsBtn = document.getElementById('settingsButton');
    const newSessionBtn = document.getElementById('newSessionButton');
    const contextCheckbox = document.getElementById('contextCheckbox');
    const md = window.markdownit({ html: false, linkify: true, typographer: true });

    let shouldAutoScroll = true;
    let userInitiatedScroll = false;
    let isStreaming = false;
    let assistantRaw = '';
    let assistantElem = null;

    // Auto-scroll logic
    chat.addEventListener('scroll', () => {
      const buffer = 5;
      const atBottom =
        chat.scrollTop + chat.clientHeight >= chat.scrollHeight - buffer;
      if (!userInitiatedScroll && !atBottom) return;
      shouldAutoScroll = atBottom;
      scrollBtn.style.display = atBottom ? 'none' : 'block';
    });

    ['wheel', 'touchstart', 'mousedown'].forEach(evt =>
      chat.addEventListener(evt, () => (userInitiatedScroll = true), {
        passive: true
      })
    );

    scrollBtn.addEventListener('click', () => {
      shouldAutoScroll = true;
      userInitiatedScroll = false;
      scrollToBottom(true);
    });

    function scrollToBottom(force = false) {
      if (!force && !shouldAutoScroll) return;
      requestAnimationFrame(() => {
        chat.scrollTop = chat.scrollHeight;
      });
      scrollBtn.style.display = 'none';
    }

    // Observe new messages to auto-scroll on code blocks
    const observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (isStreaming && shouldAutoScroll) {
          scrollToBottom(true);
          return;
        }
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && node.querySelector('pre')) {
            scrollToBottom();
            return;
          }
        }
      }
    });
    observer.observe(chat, { childList: true, subtree: true });

    function renderMd(text) {
      return md.render(text);
    }

    function injectLinks(container) {
      container.querySelectorAll('pre').forEach(pre => {
        const codeText = pre.innerText;
        ['copy', 'insert'].forEach(label => {
          const a = document.createElement('a');
          a.href = '#';
          a.className = label + '-link';
          a.textContent = label.charAt(0).toUpperCase() + label.slice(1);
          a.dataset.code = codeText;
          pre.parentNode.insertBefore(a, pre);
        });
      });
    }

    function appendBubble(raw, cls, tokenCount = null) {
      const bubble = document.createElement('div');
      bubble.className = 'message ' + cls;
      const prefix = cls === 'user-message' ? 'You:' : 'Assistant:';
      const tokenHtml =
        tokenCount !== null
          ? \`<div class="token-count">🧮 \${tokenCount} tokens</div>\`
          : '';
      bubble.innerHTML = \`
        <div class="markdown-body">
          <strong>\${prefix}</strong><br/>
          \${renderMd(raw)}
          \${tokenHtml}
        </div>
      \`;
      injectLinks(bubble);
      chat.appendChild(bubble);
      scrollToBottom();
      return bubble;
    }

    window.addEventListener('message', ev => {
      const {
        type,
        message,
        tokens,
        maxTokens,
        sessionTokens,
        fileContextTokens,
        totalTokens
      } = ev.data;

      switch (type) {
        case 'startStream':
          isStreaming = true;
          assistantRaw = '';
          assistantElem = appendBubble('…', 'ai-message thinking');
          sendBtn.textContent = 'Stop';
          break;

        case 'streamChunk':
          if (assistantElem?.classList.contains('thinking')) {
            assistantElem.classList.remove('thinking');
          }
          assistantRaw += message;
          const mdBody = assistantElem.querySelector('.markdown-body');
          mdBody.innerHTML =
            '<strong>Assistant:</strong><br/>' + renderMd(assistantRaw);
          injectLinks(assistantElem);
          scrollToBottom();
          break;

        case 'endStream':
        case 'stoppedStream':
          isStreaming = false;
          sendBtn.textContent = 'Send';
          break;

        case 'appendUser':
          if (message != null && typeof tokens === 'number') {
            appendBubble(message, 'user-message', tokens);
          }
          break;

        case 'fileContextTokens': {
          const ctxSpan = document.getElementById('contextTokenCount');
          if (ctxSpan && typeof tokens === 'number') {
            ctxSpan.textContent = \`(\${tokens} tokens)\`;
            ctxSpan.style.color = tokens > maxTokens ? 'red' : '#888';
          }
          break;
        }

        case 'finalizeAI':
          if (typeof tokens === 'number' && assistantElem) {
            const tokenDiv = document.createElement('div');
            tokenDiv.className = 'token-count';
            tokenDiv.textContent = \`🧮 \${tokens} tokens\`;
            assistantElem
              .querySelector('.markdown-body')
              .appendChild(tokenDiv);
          }
          break;

        case 'sessionTokenUpdate': {
          const sessionSpan = document.getElementById('sessionTokenCount');
          const fileSpan = document.getElementById('fileTokenCount');
          const totalSpan = document.getElementById('totalTokenCount');
          if (sessionSpan) sessionSpan.textContent = String(sessionTokens);
          if (fileSpan) fileSpan.textContent = String(fileContextTokens);
          if (totalSpan) totalSpan.textContent = String(totalTokens);
          break;
        }

        default:
          console.warn('Unknown message type:', type);
      }
    });

    // UI event listeners
    sendBtn.addEventListener('click', () => {
      if (sendBtn.textContent === 'Send') {
        const txt = input.value.trim();
        if (!txt) return;
        input.value = '';
        sendBtn.textContent = 'Stop';
        vscode.postMessage({
          type: 'sendToAI',
          message: txt,
          useFileContext: contextCheckbox.checked
        });
        shouldAutoScroll = true;
        userInitiatedScroll = false;
        scrollToBottom(true);
      } else {
        vscode.postMessage({ type: 'stopGeneration' });
      }
    });

    newSessionBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'newSession' });
      scrollToBottom(true);
    });

    settingsBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    contextCheckbox.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleIncludeFileContext',
        value: contextCheckbox.checked
      });
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    document.body.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof HTMLAnchorElement)) return;
      const code = t.dataset.code || '';
      if (t.matches('a.copy-link')) {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        t.textContent = 'Copied!';
        setTimeout(() => (t.textContent = 'Copy'), 2000);
      } else if (t.matches('a.insert-link')) {
        vscode.postMessage({ type: 'insertCode', message: code });
      }
    });
  </script>
</body>
</html>`;
}