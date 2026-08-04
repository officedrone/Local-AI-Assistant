// src/static/webviewScripts/chat.js
import { renderMd, injectLinks } from './markdownUtils.js';
import { scrollToBottom, setAutoScrollEnabled, setUserInitiatedScroll } from './scrollUtils.js';

let isStreaming = false;
let assistantRaw = '';
let assistantElem = null;
// NEW: Track multiple thinking bubbles separately
let thinkingBubbles = []; // Array of {id, element, buffer}

export function appendBubble(raw, cls, chatTokens, fileTokens = 0, skipRender = false) {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ' + cls;
  const prefix = cls === 'user-message' ? 'You:' : 'Assistant:';
  const content = skipRender ? raw : renderMd(raw);

  // Build bubble structure: content area + footer
  bubble.innerHTML = `
    <div class="markdown-body">
      <strong>${prefix}</strong><br/>
      ${content}
    </div>
    <div class="bubble-footer">
      <div class="token-count">
        ${chatTokens != null ? `🧮 ${chatTokens} tokens${fileTokens > 0 ? ` + ${fileTokens} file context` : ''}` : ''}
      </div>
    </div>
  `;

  injectLinks(bubble);
  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  return bubble;
}

// NEW: Create placeholder bubble for initial "processing" state
export function createPlaceholderBubble() {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message placeholder-bubble';
  bubble.id = `placeholder-${Date.now()}`;

  bubble.innerHTML = `
    <div class="markdown-body pulsing">
      <strong>Assistant:</strong><br/>
      <i>Processing your request…</i>
    </div>
  `;

  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  return bubble;
}

// src/static/webviewScripts/chat.js
export function createThinkingBubble() {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message thinking-bubble';
  bubble.id = `thinking-${Date.now()}`;

  console.log('<think> [DEBUG] createThinkingBubble called, ID:', bubble.id);

  bubble.innerHTML = `
    <div class="markdown-body thinking-container">
      <details class="thinking-details" open>
        <summary class="thinking-header">💡 Thinking…</summary>
        <div class="thinking-content"></div>
      </details>
    </div>
  `;

  chat.appendChild(bubble);

  // Auto-scroll within thinking content if needed
  const contentEl = bubble.querySelector('.thinking-content');
  if (contentEl) {
    contentEl.dataset.autoScroll = 'true';
    contentEl.addEventListener('scroll', () => {
      const atBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 20;
      contentEl.dataset.autoScroll = atBottom.toString();
    });
  }

  scrollToBottom(true, 'smooth');
  return bubble;
}


// NEW: Create assistant bubble for regular response
export function createAssistantBubble() {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message';
  bubble.id = `assistant-${Date.now()}`;

  bubble.innerHTML = `
    <div class="markdown-body">
      <strong>Assistant:</strong><br/>
    </div>
    <div class="bubble-footer">
      <div class="token-count"></div>
    </div>
  `;

  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  return bubble;
}

// NEW: Get active thinking buffer (for last thinking block)
export function getActiveThinkingBuffer() {
  if (thinkingBubbles.length === 0) return '';
  const lastBubble = thinkingBubbles[thinkingBubbles.length - 1];
  return lastBubble.buffer || '';
}

// NEW: Set active thinking buffer and update DOM
export function setActiveThinkingBuffer(content) {
  if (thinkingBubbles.length === 0) return;
  const lastBubble = thinkingBubbles[thinkingBubbles.length - 1];
  lastBubble.buffer = content;
  
  // Update DOM
  const contentEl = lastBubble.element.querySelector('.thinking-content');
  if (contentEl) {
    contentEl.innerHTML = renderMd(content);
    
    // Auto-scroll within thinking bubble if enabled
    if (contentEl.dataset.autoScroll === 'true') {
      contentEl.scrollTop = contentEl.scrollHeight;
    }
  }
}

// NEW: Add thinking bubble to tracking array
export function addThinkingBubble(element) {
  const bubbleData = {
    id: element.id,
    element: element,
    buffer: ''
  };
  thinkingBubbles.push(bubbleData);
  return bubbleData;
}

// Remove last thinking bubble from tracking (when completed)
export function removeLastThinkingBubble() {
  if (thinkingBubbles.length === 0) return null;
  const removed = thinkingBubbles.pop();
  
  // Update header to show complete and collapse the details
  const details = removed.element.querySelector('.thinking-details');
  const summary = removed.element.querySelector('.thinking-header');
  
  summary.innerHTML = '💡 Thinking complete<span class="collapse-arrow"></span>';

  
  if (details) details.removeAttribute('open');
  
  return removed;
}

// NEW: Get all thinking bubbles for finalization on stream end
export function getThinkingBubbles() {
  return [...thinkingBubbles];
}

// NEW: Clear all thinking bubbles and reset collapsed state (on new session/stop)
export function clearThinkingBubbles() {
  thinkingBubbles.forEach(b => {
    const header = b.element.querySelector('.thinking-header');
    if (header) header.textContent = '💡 Thinking complete';
    
    // Reset collapse arrow when clearing
    const existingArrow = b.element.querySelector('.collapse-arrow');
    if (existingArrow) {
      existingArrow.remove();
    }
    b.element.classList.remove('collapsed');
  });
  thinkingBubbles = [];
}

export function setStreamingState(state) {
  isStreaming = state.isStreaming;
  assistantElem = state.assistantElem;
  assistantRaw = state.assistantRaw;
  
  // NEW: Also track thinking bubbles if provided in state
  if (state.thinkingBubbles !== undefined) {
    thinkingBubbles = state.thinkingBubbles;
  }
}

export function getStreamingState() {
  return { 
    isStreaming, 
    assistantElem, 
    assistantRaw,
    thinkingBubbles: [...thinkingBubbles] // Return copy to prevent mutation
  };
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
    if (e.key === 'Enter') {
      const textarea = e.target; 

      if (e.ctrlKey && !e.shiftKey) {
        // Handle Ctrl+Enter - insert newline
        e.preventDefault();
        e.stopPropagation();

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;

        // Insert newline at cursor position
        const newText = text.substring(0, start) + '\n' + text.substring(end);
        textarea.value = newText;

        // Move cursor to after the inserted newline
        setTimeout(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = start + 1;
        }, 0);
      } else if (!e.shiftKey && textarea.value.trim()) {
        // Handle regular Enter - send message
        e.preventDefault();
        sendBtn.click();
      }
    }
  });


}
