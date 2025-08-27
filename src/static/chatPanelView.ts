// src/static/chatPanelView.ts
import * as vscode from 'vscode';
import { getSessionTokenCount, getSpentFileContextTokens } from '../commands/tokenActions';

const CONFIG_SECTION = 'localAIAssistant';

export function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
): string {
  // read user settings
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('context.includeFileContext', true);


  const contextSize = vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<number>('context.contextSize', 4096);
  panel.webview.postMessage({
    type: 'contextSize',
    value: contextSize,
  });


  const modelName = vscode.workspace
  .getConfiguration('localAIAssistant')
    .get<string>('apiLLM.config.model', '')
  ?.trim() || 'None';

  panel.webview.postMessage({
    type: 'setModel',
    value: modelName,
  });

   const displayUrl = vscode.workspace
  .getConfiguration('localAIAssistant')
    .get<string>('apiLLM.apiURL.endpoint', '')
  ?.trim() || 'None';

  panel.webview.postMessage({
    type: 'setLLMUrl',
    value: displayUrl,
  });

  const apiType = vscode.workspace
    .getConfiguration('localAIAssistant')
    .get<string>('apiLLM.apiType', 'openai') 
    ?.trim() || 'openai';
    
  panel.webview.postMessage({
    type: 'setApiType',
    value: apiType,
  });

  

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
  <div class="session-header">
    <div class="session-buttons">
      <button id="newSessionButton">📄 New Session</button>
      <button id="settingsButton" title="Settings">⚙️</button>     
    </div>
    <div id="serviceStatusContainer">
      <span class="status-label">LLM Service Status:</span>
      <span id="api-status"></span>
    </div>
  </div>

    <div class="llm-info-row">
      <span id="llmURLBox" title="Click to set LLM URL">LLM Endpoint</span>
      <span id="apiTypeBox" title="Select API Type">API Type</span>
      <span id="modelNameBox" title="Click to change model">Model Name</span>
      <button id="refreshSvcBtn" class="refreshSvcBtn" title="Refresh URL / API / Model Status">⟳</button>
    </div>

    <div id="sessionTokenContainer">
      <div class="tokenTitle">Session Token Usage</div>
      <div class="tokenRow">
        <div class="tokenItem">
          Chat: <span id="sessionTokenCount">${getSessionTokenCount()}</span>
        </div>
        <div class="tokenItem">
          Files: <span id="fileTokenCount">${getSpentFileContextTokens()}</span>
        </div>
        <div class="tokenItem">
          Total:
          <span id="totalTokenCount">
            ${getSessionTokenCount() + getSpentFileContextTokens()}
          </span>
          <span id="maxTokenLabel">
            Context size:
            <span
              id="contextSizeBox"
              title="Click to edit max tokens"
            >${contextSize}</span>
          </span>
        </div>
      </div>
    </div>
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
  (function () {
    let contextSize = ${contextSize};
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat-container');
    const scrollBtn = document.getElementById('scrollToBottomButton');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');
    const settingsBtn = document.getElementById('settingsButton');
    const newSessionBtn = document.getElementById('newSessionButton');
    const contextCheckbox = document.getElementById('contextCheckbox');
    const md = window.markdownit({ html: false, linkify: true, typographer: true });

    // Auto-scroll state
    let shouldAutoScroll = true;         // We want to stick to bottom by default
    let userInitiatedScroll = false;     // Set to true only when user actively scrolls up
    let isStreaming = false;

    // Current assistant message under construction
    let assistantRaw = '';
    let assistantElem = null;

    // Threshold within which we consider "at bottom" (px)
    const BOTTOM_THRESHOLD = 48;

    // Smooth behavior is nice for user-triggered jumps, but streaming prefers immediate
    function scrollToBottom(force = false, behavior = 'auto') {
      if (!force && !shouldAutoScroll) return;
      chat.scrollTo({ top: chat.scrollHeight, behavior });
      scrollBtn.style.display = 'none';
    }

    // Convenience for streaming: avoid queueing smooth scrolls during rapid updates
    function scrollToBottomImmediate(force = false) {
      scrollToBottom(force, 'auto');
    }

    chat.addEventListener(
      'scroll',
      function () {
        const atBottom =
          chat.scrollTop + chat.clientHeight >= chat.scrollHeight - BOTTOM_THRESHOLD;

        // If user isn't interacting and we're not at bottom, don't toggle auto-scroll off
        // This prevents layout-driven scroll events from disabling auto-scroll.
        if (!userInitiatedScroll && !atBottom) {
          scrollBtn.style.display = 'block';
          return;
        }

        // When user is interacting, only disable auto-scroll if they have moved away from bottom.
        // Re-enable auto-scroll automatically once they return to bottom.
        shouldAutoScroll = atBottom;

        // If we've returned to bottom, consider user "not scrolling" anymore.
        if (atBottom) {
          userInitiatedScroll = false;
          scrollBtn.style.display = 'none';
        } else {
          scrollBtn.style.display = 'block';
        }
      },
      { passive: true }
    );

    // Mark that the user is about to scroll; we only actually disable once they are away from bottom
    ['wheel', 'touchstart', 'mousedown'].forEach(function (evt) {
      chat.addEventListener(
        evt,
        function () {
          userInitiatedScroll = true;
        },
        { passive: true }
      );
    });

    scrollBtn.onclick = function () {
      shouldAutoScroll = true;
      userInitiatedScroll = false;
      scrollToBottom(true, 'smooth');
    };

    // Mutation observer keeps us pinned while streaming and on new code blocks
    new MutationObserver(function (records) {
      records.forEach(function (rec) {
        if (isStreaming) {
          if (shouldAutoScroll) scrollToBottomImmediate(true);
          return;
        }
        rec.addedNodes.forEach(function (node) {
          if (
            shouldAutoScroll &&
            node instanceof HTMLElement &&
            node.querySelector('pre')
          ) {
            scrollToBottom(true, 'smooth');
          }
        });
      });
    }).observe(chat, { childList: true, subtree: true });

    function renderMd(text) {
      return md.render(text);
    }

    // Avoid duplicating "Copy/Insert" links while streaming by marking <pre> once processed
    function injectLinks(container) {
      container.querySelectorAll('pre').forEach(function (pre) {
        if (pre.dataset.linksInjected === '1') return;
        pre.dataset.linksInjected = '1';
        const codeText = pre.innerText;

        ['copy', 'insert'].forEach(function (label) {
          const a = document.createElement('a');
          a.href = '#';
          a.className = label + '-link';
          a.textContent = label.charAt(0).toUpperCase() + label.slice(1);
          a.dataset.code = codeText;
          pre.parentNode.insertBefore(a, pre);
        });
      });
    }

    function appendBubble(raw, cls, tokenCount) {
      const bubble = document.createElement('div');
      bubble.className = 'message ' + cls;
      const prefix = cls === 'user-message' ? 'You:' : 'Assistant:';
      bubble.innerHTML =
        '<div class="markdown-body">' +
        '<strong>' +
        prefix +
        '</strong><br/>' +
        renderMd(raw) +
        (tokenCount != null
          ? '<div class="token-count">🧮 ' + tokenCount + ' tokens</div>'
          : '') +
        '</div>';
      injectLinks(bubble);
      chat.appendChild(bubble);

      // Always scroll for newly appended messages (chat trigger)
      scrollToBottom(true, 'smooth');
      return bubble;
    }

    window.addEventListener('message', function (ev) {
      const { type, message, tokens, sessionTokens, fileContextTokens, totalTokens } =
        ev.data;
      switch (type) {
        case 'startStream':
          isStreaming = true;
          assistantRaw = '';
          assistantElem = appendBubble('…', 'ai-message thinking');
          sendBtn.textContent = 'Stop';
          // Reset any accidental user-scroll lock and pin to bottom
          userInitiatedScroll = false;
          shouldAutoScroll = true;
          scrollToBottomImmediate(true);
          break;

        case 'streamChunk':
          if (assistantElem && assistantElem.classList.contains('thinking')) {
            assistantElem.classList.remove('thinking');
          }
          assistantRaw += message;
          // Update content
          const body = assistantElem.querySelector('.markdown-body');
          body.innerHTML = '<strong>Assistant:</strong><br/>' + renderMd(assistantRaw);
          injectLinks(assistantElem);
          // Keep pinned during streaming
          if (shouldAutoScroll) scrollToBottomImmediate(true);
          break;

        case 'appendAssistant':
          if (isStreaming) break;
          if (message && typeof tokens === 'number') {
            appendBubble(message, 'ai-message', tokens);
          }
          break;

        case 'endStream':
        case 'stoppedStream':
          isStreaming = false;
          sendBtn.textContent = 'Send';
          assistantRaw = '';
          assistantElem = null;

          break;

        case 'appendUser':
          if (message && typeof tokens === 'number') {
            appendBubble(message, 'user-message', tokens);
          }
          break;

        case 'fileContextTokens': {
          const span = document.getElementById('contextTokenCount');
          const includeFile = contextCheckbox?.checked;
          if (span) {
            if (!includeFile) {
              span.textContent = '(0 tokens)';
              span.style.color = '';
            } else if (typeof tokens === 'number') {
              span.textContent = '(' + tokens + ' tokens)';
              span.style.color = tokens > contextSize ? 'red' : '';
            }
          }
          break;
        }


        case 'finalizeAI':
          if (assistantElem && typeof tokens === 'number') {
            const tdiv = document.createElement('div');
            tdiv.className = 'token-count';
            tdiv.textContent = '🧮 ' + tokens + ' tokens';
            assistantElem.querySelector('.markdown-body').appendChild(tdiv);
            // Pin to bottom when finalizing
            scrollToBottomImmediate(true);
          }
          break;

        case 'setModel': {
          const modelSpan = document.getElementById('modelNameBox');
          if (modelSpan) {
            const displayName = ev.data.value && ev.data.value.trim()
              ? ev.data.value
              : 'None';
            modelSpan.textContent = 'Model: ' + displayName;

            // Reattach click listener after updating content
            modelSpan.onclick = () => {
              vscode.postMessage({ 
                type: 'invokeCommand', command: 'extension.selectModel' 
              });
            };
            vscode.postMessage({ type: 'refreshApiStatus' });
          }
          break;
        }

          
        case 'setApiType': {
          const apiTypeSpan = document.getElementById('apiTypeBox');
          if (apiTypeSpan) {
            const displayName = ev.data.value && ev.data.value.trim()
              ? ev.data.value
              : 'None';
            apiTypeSpan.textContent = 'API: ' + displayName;

            // Reattach click listener after updating content
            apiTypeSpan.onclick = () => {
              vscode.postMessage({
                type: 'invokeCommand',
                command: 'extension.selectApiType'
              });
            };
          }
          break;
        }


        case 'setLLMUrl': {
          const urlSpan = document.getElementById('llmURLBox');
          if (urlSpan) {
            const displayUrl = ev.data.value && ev.data.value.trim()
              ? ev.data.value
              : 'None';
            urlSpan.textContent = 'URL: ' + displayUrl;

            // Reattach click listener after updating content
            urlSpan.onclick = () => {
              vscode.postMessage({
                type: 'invokeCommand',
                command: 'extension.setApiURL'
              });
            };
          }
          break;
        }

        case 'contextSize': {
          const tokenSpan = document.getElementById('contextSizeBox');
          if (tokenSpan) {
            const displayTokens = typeof ev.data.value === 'number'
              ? ev.data.value.toString()
              : 'Unknown';

            tokenSpan.textContent = displayTokens;
            tokenSpan.title = 'Click to edit context size';

            tokenSpan.onclick = () => {
              vscode.postMessage({
                type: 'invokeCommand',
                key: 'extension.setContextSize'
              });


            };
          }
          contextSize = ev.data.value;
          break;
        }

        case 'sessionTokenUpdate': {
          document.getElementById('sessionTokenCount').textContent =
            String(sessionTokens);

          const fileTokenSpan = document.getElementById('fileTokenCount');
          const includeFile = contextCheckbox?.checked;
          fileTokenSpan.textContent = includeFile ? String(fileContextTokens) : '0';

          const totalSpan = document.getElementById('totalTokenCount');
          totalSpan.textContent = String(totalTokens);
          totalSpan.style.color = totalTokens > contextSize ? 'orange' : '';
          break;
        }
        
        case 'apiReachability': {
          const indicator = document.getElementById('api-status');
          const urlSpan = document.getElementById('llmURLBox');
          const apiTypeSpan = document.getElementById('apiTypeBox');
          const modelSpan = document.getElementById('modelNameBox');

          if (!indicator || !urlSpan || !apiTypeSpan || !modelSpan) break;

          const { serviceUp, hasModels, models } = ev.data.value;

          // Softer palette
          const softRed    = '#d66';
          const softOrange = '#d68b00';
          const softGreen  = '#2e8540';

          const currentUrl = urlSpan.textContent.replace(/^URL:\s*/i, '').trim();

          // Normalize model IDs into array of strings
          let modelIds = [];
          if (Array.isArray(models)) {
            if (typeof models[0] === 'string') {
              modelIds = models.map(m => m.trim());
            } else {
              modelIds = models.map(m => m && m.id ? String(m.id).trim() : '').filter(Boolean);
            }
          } else if (models && Array.isArray(models.data)) {
            modelIds = models.data
              .map(m => m && m.id ? String(m.id).trim() : '')
              .filter(Boolean);
          }

          // Lowercase for case-insensitive matching
          const normalizedIds = modelIds.map(id => id.toLowerCase());
          const currentModel = modelSpan.textContent.replace(/^Model:\s*/, '').trim().toLowerCase();

          if (!currentUrl || currentUrl.toLowerCase() === 'none') {
            indicator.textContent = '🔌 No URL';
            indicator.style.color = softRed;
            urlSpan.style.color = softRed;
            apiTypeSpan.style.color = softRed;
            modelSpan.style.color = softRed;
          }
          else if (!serviceUp) {
            indicator.textContent = '🔌 Offline';
            indicator.style.color = softRed;
            urlSpan.style.color = softRed;
            apiTypeSpan.style.color = softRed;
            modelSpan.style.color = softRed;
          }
          else if (!hasModels) {
            indicator.textContent = '🚦 No models';
            indicator.style.color = softOrange;
            urlSpan.style.color = softGreen; // reachable but wrong API
            apiTypeSpan.style.color = softOrange;
            modelSpan.style.color = softOrange;
          }
          else {
            // API up with models
            urlSpan.style.color = softGreen;
            apiTypeSpan.style.color = softGreen;

            if (normalizedIds.includes(currentModel)) {
              indicator.textContent = '✅ Online';
              indicator.style.color = softGreen;
              modelSpan.style.color = softGreen;
            } else {
              indicator.textContent = '❌ Wrong model';
              indicator.style.color = softOrange;
              modelSpan.style.color = softOrange;
              // URL stays green for reachable service
              urlSpan.style.color = softGreen;
            }
          }
          break;
        }




        // Ensure we scroll when code is validated or code input is acknowledged by the backend.
        case 'codeValidated':
        case 'codeInput':
          scrollToBottomImmediate(true);
          break;

        default:
          console.warn('Unknown message type:', type);
      }
    });

    // Chat send/stop
    sendBtn.onclick = () => {
      if (sendBtn.textContent === 'Send') {
        const txt = input.value.trim();
        if (!txt) return;
        input.value = '';
        sendBtn.textContent = 'Stop';
        // User initiated a new message; reset auto-scroll and pin
        userInitiatedScroll = false;
        shouldAutoScroll = true;
        vscode.postMessage({
          type: 'sendToAI',
          message: txt,
          useFileContext: contextCheckbox.checked
        });
        // Chat trigger: scroll to bottom
        scrollToBottom(true, 'smooth');
      } else {
        vscode.postMessage({ type: 'stopGeneration' });
      }
    };


    document.getElementById('modelNameBox').addEventListener('click', () => {
      vscode.postMessage({ 
      type: 'invokeCommand', command: 'extension.selectModel' 
      });
    });

    document.getElementById('llmURLBox')?.addEventListener('click', () => {
      vscode.postMessage({
        type: 'invokeCommand',
        command: 'extension.setApiURL'
      });
    });

    document.getElementById('apiTypeBox')?.addEventListener('click', () => {
      vscode.postMessage({
        type: 'invokeCommand',
        command: 'extension.selectApiType'
      });
    });

    document.getElementById('contextSizeBox')?.addEventListener('click', () => {
      vscode.postMessage({
        type: 'invokeCommand',
        command: 'extension.setContextSize'
      });
    });

    document.getElementById('refreshSvcBtn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshApiStatus' });
    });


    newSessionBtn.onclick = function () {
      userInitiatedScroll = false;
      shouldAutoScroll = true;
      vscode.postMessage({ type: 'newSession' });
      scrollToBottom(true, 'smooth');
    };

    settingsBtn.onclick = function () {
      vscode.postMessage({ type: 'openSettings' });
    };

    contextCheckbox.onchange = function () {
      vscode.postMessage({
        type: 'toggleIncludeFileContext',
        value: contextCheckbox.checked
      });
    };

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    document.getElementById('editContextLink')?.addEventListener('click', function (e) {
      e.preventDefault();
      vscode.postMessage({
        type: 'openSettings',
        key: 'localAIAssistant.context.contextSize'
      });
    });

    // Code actions: copy/insert should also keep the conversation pinned to bottom
    document.body.addEventListener('click', function (e) {
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
        setTimeout(function () {
          t.textContent = 'Copy';
        }, 2000);
        // Code validate-related UX (copy) — scroll to bottom
      } else if (t.classList.contains('insert-link')) {
        vscode.postMessage({ type: 'insertCode', message: code });
        // Code input action (insert) — scroll to bottom
      }

      vscode.postMessage({ type: 'webviewReady' });
    });
  })();
</script>
</body>
</html>`;
}
