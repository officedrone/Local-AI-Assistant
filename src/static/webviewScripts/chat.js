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

// NEW: Create collapsed tool result bubble showing what was sent to LLM
export function appendToolResultBubble(toolType, summary, content) {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message tool-result-bubble';
  bubble.id = `tool-result-${Date.now()}`;

  // Escape HTML in content for display
  const escapedContent = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  bubble.innerHTML = `
    <div class="markdown-body">
      <details class="tool-result-details" open>
        <summary class="tool-result-header">🔧 ${escapeHtml(summary)}</summary>
        <pre class="tool-result-content">${escapedContent}</pre>
      </details>
    </div>
  `;

  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  return bubble;
}

// Helper: escape HTML for summary text
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format tool type name for display (camelCase to Title Case with spaces)
 */
export function formatToolName(toolType) {
  // Convert camelCase to "Title Case Words"
  return toolType
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Track tool bubbles for lifecycle management
let toolBubbles = []; // Array of {id, element, buffer, status, payload}
let retryBubbleCount = 0; // For unique IDs

/**
 * Create a new tool call bubble (collapsed by default)
 * @param {string} toolType - Type of tool being called
 * @returns {HTMLElement} The created tool bubble element
 */
export function createToolBubble(toolType = 'Unknown') {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message tool-bubble';
  bubble.id = `tool-${Date.now()}`;

  // Format tool type for display (e.g., "searchInFile" → "Search In File")
  const displayName = formatToolName(toolType);
  const timestamp = new Date().toLocaleTimeString();

  bubble.innerHTML = `
    <div class="markdown-body tool-container">
      <details class="tool-details" open>
        <summary class="tool-header">
          <span class="tool-header-content">
            <span class="tool-status-indicator tool-status-spinner"></span>
            <span>🔧 Tool Call - ${displayName}</span>
            <span class="tool-timestamp">${timestamp}</span>
          </span>
        </summary>
        <div class="tool-content">
          <pre class="tool-payload">// Loading...</pre>
          <div class="tool-result"></div>
        </div>
      </details>
    </div>
  `;

  chat.appendChild(bubble);
  
  const contentEl = bubble.querySelector('.tool-content');
  if (contentEl) {
    contentEl.dataset.autoScroll = 'true';
    contentEl.addEventListener('scroll', () => {
      const atBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 20;
      contentEl.dataset.autoScroll = atBottom.toString();
    });
  }

  console.log(`[Dev-Tool] createToolBubble: type=${toolType}, id=${bubble.id}`);
  scrollToBottom(true, 'smooth');
  
  return bubble;
}

/**
 * Update tool bubble title with actual tool name after JSON is parsed
 */
export function updateToolBubbleTitle(bubbleId, toolType) {
  const bubble = toolBubbles.find(t => t.id === bubbleId);
  if (!bubble) return;
  
  bubble.payload = bubble.payload || {};
  bubble.payload.type = toolType;
  
  const displayName = formatToolName(toolType);
  const header = bubble.element.querySelector('.tool-header');
  if (header) {
    const content = header.querySelector('.tool-header-content');
    if (content) {
      const spans = content.querySelectorAll('span');
      if (spans.length >= 2 && !bubble.element.querySelector('.tool-details')?.getAttribute('open')) {
        spans[1].textContent = `🔧 Tool Call - ${displayName}`;
      }
    }
  }
}

/**
 * Add tool bubble to tracking array
 */
export function addToolBubble(element) {
  const bubbleData = {
    id: element.id,
    element: element,
    buffer: '',
    status: 'pending', // pending | executing | complete | error
    payload: null
  };
  toolBubbles.push(bubbleData);
  return bubbleData;
}

/**
 * Update tool bubble with accumulated JSON payload
 */
export function updateToolBubblePayload(bubbleId, jsonPayload) {
  console.log(`[Dev-Tool] updateToolBubblePayload: id=${bubbleId}, payloadLength=${jsonPayload.length}`);
  const bubble = toolBubbles.find(t => t.id === bubbleId);
  if (!bubble) return;

  bubble.buffer = jsonPayload;
  
  const payloadEl = bubble.element.querySelector('.tool-payload');
  if (payloadEl) {
    payloadEl.textContent = jsonPayload;
  }
  
  const contentEl = bubble.element.querySelector('.tool-content');
  if (contentEl && contentEl.dataset.autoScroll === 'true') {
    void contentEl.offsetHeight;
    contentEl.scrollTop = contentEl.scrollHeight;
  }
}

/**
 * Mark tool as executing (spinner continues)
 */
export function markToolExecuting(bubbleId) {
  console.log(`[Dev-Tool] markToolExecuting: id=${bubbleId}`);
  const bubble = toolBubbles.find(t => t.id === bubbleId);
  if (!bubble) return;

  bubble.status = 'executing';
  
  // Update status indicator to ensure spinner is showing
  const indicator = bubble.element.querySelector('.tool-status-indicator');
  if (indicator) {
    indicator.className = 'tool-status-indicator tool-status-spinner';
  }
}

/**
 * Close tool bubble with result or error
 */
export function closeToolBubble(bubbleId, result = null, isError = false) {
  console.log(`[Dev-Tool] closeToolBubble called: bubbleId=${bubbleId}, toolBubbles.length=${toolBubbles.length}`);
  toolBubbles.forEach((t, i) => {
    console.log(`[Dev-Tool]   toolBubbles[${i}]: id=${t.id}, status=${t.status}`);
  });
  
  const bubble = toolBubbles.find(t => t.id === bubbleId);
  if (!bubble) {
    console.error(`[Dev-Tool] closeToolBubble: bubble NOT FOUND for id=${bubbleId}`);
    return;
  }

  console.log(`[Dev-Tool] closeToolBubble: found bubble, hasResult=${!!result}, isError=${isError}`);

  bubble.status = isError ? 'error' : 'complete';
  
  const indicator = bubble.element.querySelector('.tool-status-indicator');
  if (indicator) {
    indicator.className = `tool-status-indicator tool-status-${isError ? 'error' : 'complete'}`;
  }

  // Collapse when finalized and update header
  const details = bubble.element.querySelector('.tool-details');
  console.log(`[Dev-Tool] closeToolBubble: found details element=${!!details}`);
  if (details) {
    console.log(`[Dev-Tool] closeToolBubble: BEFORE - details.open=${details.open}`);
    details.removeAttribute('open');
    
    const summary = bubble.element.querySelector('.tool-header');
    if (summary) {
      const content = summary.querySelector('.tool-header-content');
      if (content && content.querySelector('span:nth-child(2)')) {
        const toolNameSpan = content.querySelector('span:nth-child(2)');
        const displayName = formatToolName(bubble.payload?.type || 'Unknown');
        toolNameSpan.textContent = `🔧 Tool Call Complete - ${displayName}`;
      }
    }
    
    console.log(`[Dev-Tool] closeToolBubble: AFTER - details.open=${details.open}`);
  } else {
    console.error('[Dev-Tool] closeToolBubble: details element NOT FOUND!');
  }

  // Add result content
  const resultEl = bubble.element.querySelector('.tool-result');
  if (resultEl) {
    if (isError) {
      resultEl.className = 'tool-result error';
      resultEl.innerHTML = `<strong>Error:</strong> ${escapeHtml(result || 'Unknown error')}`;
    } else if (result) {
      // Result received from extension - update header too
      resultEl.className = 'tool-result';
      resultEl.innerHTML = `<strong>Result:</strong><br/>${escapeHtml(result)}`;
      
      // Update the tool call header to show spinner → checkmark
      const headerSummary = bubble.element.querySelector('.tool-header');
      if (headerSummary && !isError) {
        const content = headerSummary.querySelector('.tool-header-content');
        if (content) {
          const spans = content.querySelectorAll('span');
          if (spans.length >= 2) {
            // Keep the tool name but update status indicator
            spans[0].className = 'tool-status-indicator tool-status-complete';
          }
        }
      }
    } else {
      // Still executing - show waiting message, keep spinner in header
      resultEl.className = 'tool-result';
      resultEl.innerHTML = `<span class="status-reason">⟳ Executing tool...</span>`;
    }
  }
}

/**
 * Create retry feedback bubble
 */
export function createRetryBubble(toolType, attemptNumber, maxAttempts) {
  const chat = document.getElementById('chat-container');
  const bubble = document.createElement('div');
  bubble.className = 'message ai-message retry-bubble';
  bubble.id = `retry-${Date.now()}-${++retryBubbleCount}`;

  const remaining = maxAttempts - attemptNumber;
  const message = remaining > 0 
    ? `⚠️ Tool '${formatToolName(toolType)}' failed, retrying (attempt ${attemptNumber}/${maxAttempts})...`
    : `⚠️ Tool '${formatToolName(toolType)}' failed after ${maxAttempts} retries. Please try a different approach.`;

  bubble.innerHTML = `
    <div class="markdown-body">
      <div class="retry-header">
        <span>${remaining > 0 ? '⟳' : '⚠️'}</span>
        <span>${message}</span>
      </div>
    </div>
  `;

  chat.appendChild(bubble);
  scrollToBottom(true, 'smooth');
  
  return bubble;
}

/**
 * Get active (last) tool bubble that's still pending or executing
 */
export function getActiveToolBubble() {
  if (toolBubbles.length === 0) {
    console.log('[Dev-Tool] getActiveToolBubble: no bubbles');
    return null;
  }
  
  console.log(`[Dev-Tool] getActiveToolBubble: checking ${toolBubbles.length} bubbles`);
  toolBubbles.forEach((t, i) => {
    console.log(`[Dev-Tool]   toolBubbles[${i}]: id=${t.id}, status=${t.status}`);
  });
  
  const last = toolBubbles[toolBubbles.length - 1];
  console.log(`[Dev-Tool] getActiveToolBubble: last bubble id=${last.id}, status=${last.status}`);
  
  if (last.status === 'pending' || last.status === 'executing') {
    console.log(`[Dev-Tool] getActiveToolBubble: returning bubble ${last.id}`);
    return last;
  }
  console.log('[Dev-Tool] getActiveToolBubble: bubble not active');
  return null;
}

/**
 * Get all tool bubbles
 */
export function getToolBubbles() {
  return [...toolBubbles];
}

/**
 * Clear all tool bubbles (on new session)
 */
export function clearToolBubbles() {
  toolBubbles.forEach(b => {
    if (b.element.parentNode) {
      b.element.parentNode.removeChild(b.element);
    }
  });
  toolBubbles = [];
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
    
    // Force reflow to ensure proper scroll calculations
    void contentEl.offsetHeight;
    
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
  
  // Sync button state with streaming state on every click as safety fallback
  const updateButtonTextFromState = () => {
    const state = getStreamingState();
    if (state.isStreaming) {
      sendBtn.textContent = 'Stop';
    } else {
      sendBtn.textContent = 'Send';
    }
  };
  
  sendBtn.onclick = () => {
    if (sendBtn.textContent === 'Send') {
      const txt = input.value.trim();
      if (!txt) return;
      input.value = '';
      
      // Button state will be updated by syncStreamingState message from extension
      // Fallback update in case sync message is delayed
      setTimeout(updateButtonTextFromState, 50);
      
      try {
        vscode.postMessage({
          type: 'sendToAI',
          message: txt,
          mode: 'chat'
        });
        
        scrollToBottom(true, 'smooth');
        setUserInitiatedScroll(false);
        setAutoScrollEnabled(true);
      } catch (err) {
        // Silent recovery - reset button state on failure
        sendBtn.textContent = 'Send';
      }
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
