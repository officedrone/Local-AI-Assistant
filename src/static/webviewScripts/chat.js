// src/static/webviewScripts/chat.js
import { renderMd, injectLinks } from './markdownUtils.js';
import { scrollToBottom } from './scrollUtils.js';
import { getContextState } from './contextControls.js';
import { setAutoScrollEnabled, setUserInitiatedScroll } from './scrollUtils.js';

let isStreaming = false;
let assistantRaw = '';
let assistantElem = null;

export function appendBubble(raw, cls, tokenCount, skipRender = false) {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ' + cls;
  const prefix = cls === 'user-message' ? 'You:' : 'Assistant:';
  const content = skipRender ? raw : renderMd(raw);
  bubble.innerHTML =
    `<div class="markdown-body">
      <strong>${prefix}</strong><br/>
      ${content}
      ${tokenCount != null ? `<div class="token-count">🧮 ${tokenCount} tokens</div>` : ''}
    </div>`;
  injectLinks(bubble);
  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  return bubble;
}


export function setStreamingState(state) {
  isStreaming = state.isStreaming;
  assistantElem = state.assistantElem;
  assistantRaw = state.assistantRaw;
}

export function getStreamingState() {
  return { isStreaming, assistantElem, assistantRaw };
}

export function setupChatSend(vscode) {
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendButton');
  sendBtn.onclick = () => {
    if (sendBtn.textContent === 'Send') {
      const txt = input.value.trim();
      if (!txt) return;
      input.value = '';
      sendBtn.textContent = 'Stop';

      // Post sendToAI with explicit mode and context
      vscode.postMessage({
        type: 'sendToAI',
        message: txt,
        mode: 'chat',                 // default mode for chat input
        useFileContext: getContextState()
      });
      scrollToBottom(true, 'smooth');
      setUserInitiatedScroll(false);
      setAutoScrollEnabled(true);
    } else {
      vscode.postMessage({ type: 'stopGeneration' });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
}
