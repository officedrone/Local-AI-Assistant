import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

export function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
): string {
  // read user settings
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('includeFileContext', true);

  const maxTokens = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxTokens', 4096);

  // build URIs to our static resources
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
  <div id="session-controls">
    <div class="session-buttons">
      <button id="newSessionButton">📄New Session</button>
      <button id="settingsButton" title="Settings">⚙️</button>
    </div>

    <div id="sessionTokenContainer">
     🧮 Session Token Usage | Chat: <span id="sessionTokenCount">0</span> |
      File: <span id="fileTokenCount">0</span> |
      Total: <span id="totalTokenCount">0</span>
      <span id="maxTokenLabel">
        (Context: ${maxTokens}
        <a href="#" id="editContextLink" title="Edit context size">⚙️</a>)
      </span>
    </div>
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
    <label for="contextCheckbox">
      <input
        type="checkbox"
        id="contextCheckbox"
        ${includeCtx ? 'checked' : ''}
      />
      <span>Include current file in context</span>
      <span id="contextTokenCount"></span>
    </label>
  </div>

  <script src="${mdItUri}"></script>
  <script>
    (function() {
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

      // Smooth scroll helper
      function scrollToBottom(force = false) {
        if (!force && !shouldAutoScroll) return;
        chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
        scrollBtn.style.display = 'none';
      }

      // Track scroll position and show/hide scroll button
      chat.addEventListener('scroll', () => {
        const buffer = 5;
        const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - buffer;

        // Ignore minor scrolls until user explicitly scrolls
        if (!userInitiatedScroll && !atBottom) return;

        shouldAutoScroll = atBottom;
        scrollBtn.style.display = atBottom ? 'none' : 'block';
      }, { passive: true });

      // Flag when user manually scrolls
      ['wheel','touchstart','mousedown'].forEach(evt => {
        chat.addEventListener(evt, () => { userInitiatedScroll = true; }, { passive: true });
      });

      // Re-enable auto-scroll on button click
      scrollBtn.onclick = () => {
        shouldAutoScroll = true;
        userInitiatedScroll = false;
        scrollToBottom(true);
      };

      // Keep scrolling when AI is streaming or code blocks appear
      new MutationObserver(records => {
        records.forEach(rec => {
          // only scroll if streaming _and_ user hasn't locked it
          if (isStreaming && shouldAutoScroll) {
            scrollToBottom(true);
            return;
          }
          // still allow scrolling on code-block injections
          rec.addedNodes.forEach(node => {
            if (node instanceof HTMLElement && node.querySelector('pre')) {
              scrollToBottom();
            }
          });
        });
      }).observe(chat, { childList: true, subtree: true });

      function renderMd(text) {
        return md.render(text);
      }

      function injectLinks(container) {
        container.querySelectorAll('pre').forEach(pre => {
          const codeText = pre.innerText;
          ['copy','insert'].forEach(label => {
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
        bubble.innerHTML = \`
          <div class="markdown-body">
            <strong>\${prefix}</strong><br/>\${renderMd(raw)}
            \${tokenCount != null
              ? '<div class="token-count">🧮 ' + tokenCount + ' tokens</div>'
              : ''}
          </div>\`;
        injectLinks(bubble);
        chat.appendChild(bubble);
        scrollToBottom();
        return bubble;
      }

      window.addEventListener('message', ev => {
        const { type, message, tokens, sessionTokens, fileContextTokens, totalTokens } = ev.data;
        switch (type) {
          case 'startStream':
            isStreaming = true;
            assistantRaw = '';
            assistantElem = appendBubble('…', 'ai-message thinking');
            sendBtn.textContent = 'Stop';
            break;

          case 'streamChunk':
            if (assistantElem?.classList.contains('thinking'))
              assistantElem.classList.remove('thinking');
            assistantRaw += message;
            assistantElem.querySelector('.markdown-body').innerHTML =
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
            if (message && typeof tokens === 'number') {
              appendBubble(message, 'user-message', tokens);
            }
            break;

          case 'fileContextTokens': {
            const span = document.getElementById('contextTokenCount');
            if (span && typeof tokens === 'number') {
              span.textContent = \`(\${tokens} tokens)\`;
              span.style.color = tokens > ${maxTokens} ? 'red' : '';
            }
            break;
          }

          case 'finalizeAI':
            if (assistantElem && typeof tokens === 'number') {
              const tdiv = document.createElement('div');
              tdiv.className = 'token-count';
              tdiv.textContent = \`🧮 \${tokens} tokens\`;
              assistantElem.querySelector('.markdown-body').appendChild(tdiv);
            }
            break;

          case 'sessionTokenUpdate': {
            document.getElementById('sessionTokenCount').textContent = String(sessionTokens);
            document.getElementById('fileTokenCount').textContent = String(fileContextTokens);
            const totalSpan = document.getElementById('totalTokenCount');
            totalSpan.textContent = String(totalTokens);
            totalSpan.style.color = totalTokens > ${maxTokens} ? 'orange' : '';
            break;
          }

          default:
            console.warn('Unknown message type:', type);
        }
      });

      sendBtn.onclick = () => {
        if (sendBtn.textContent === 'Send') {
          const txt = input.value.trim();
          if (!txt) return;
          input.value = '';
          sendBtn.textContent = 'Stop';
          userInitiatedScroll = false;
          vscode.postMessage({
            type: 'sendToAI',
            message: txt,
            useFileContext: contextCheckbox.checked
          });
          scrollToBottom(true);
        } else {
          vscode.postMessage({ type: 'stopGeneration' });
        }
      };

      newSessionBtn.onclick = () => {
        userInitiatedScroll = false;
        vscode.postMessage({ type: 'newSession' });
        scrollToBottom(true);
      };

      settingsBtn.onclick = () => vscode.postMessage({ type: 'openSettings' });

      contextCheckbox.onchange = () =>
        vscode.postMessage({
          type: 'toggleIncludeFileContext',
          value: contextCheckbox.checked
        });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });

      document.getElementById('editContextLink')?.addEventListener('click', e => {
        e.preventDefault();
        vscode.postMessage({
          type: 'openSettings',
          key: 'localAIAssistant.context.contextSize'
        });
      });

      document.body.addEventListener('click', e => {
        const t = e.target;
        if (!(t instanceof HTMLAnchorElement)) return;
        const code = t.dataset.code || '';
        if (t.classList.contains('copy-link')) {
          const ta = document.createElement('textarea');
          ta.value = code;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          t.textContent = 'Copied!';
          setTimeout(() => (t.textContent = 'Copy'), 2000);
        } else if (t.classList.contains('insert-link')) {
          vscode.postMessage({ type: 'insertCode', message: code });
        }
      });
    })();
  </script>
</body>
</html>`;
}
