// src/static/webviewScripts/chat.js
import { renderMd, injectLinks } from './markdownUtils.js';
import { scrollToBottom, setAutoScrollEnabled, setUserInitiatedScroll } from './scrollUtils.js';

let isStreaming = false;
let assistantRaw = '';
let assistantElem = null;

export function appendBubble(raw, cls, chatTokens, fileTokens = 0, skipRender = false) {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ' + cls;
  const prefix = cls === 'user-message' ? 'You:' : 'Assistant:';
  const content = skipRender ? raw : renderMd(raw);

  let tokenInfo = '';
  if (chatTokens != null) {
    tokenInfo = `🧮 ${chatTokens} tokens`;
    if (fileTokens > 0) {
      tokenInfo += ` + ${fileTokens} file context`;
    }
    tokenInfo = `<div class="token-count">${tokenInfo}</div>`;
  }

  bubble.innerHTML =
    `<div class="markdown-body">
       <strong>${prefix}</strong><br/>
       ${content}
       ${tokenInfo}
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

      // Post sendToAI with explicit mode
      vscode.postMessage({
        type: 'sendToAI',
        message: txt,
        mode: 'chat'
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
