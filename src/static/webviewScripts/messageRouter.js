// src/static/webviewScripts/messageRouter.js
import { 
  appendBubble, 
  getStreamingState, 
  setStreamingState,
  createPlaceholderBubble,
  createThinkingBubble,
  createAssistantBubble,
  addThinkingBubble,
  removeLastThinkingBubble,
  setActiveThinkingBuffer,
  getActiveThinkingBuffer,
  clearThinkingBubbles,
  getThinkingBubbles
} from './chat.js';
import { updateContextTokens, updateContextFileList } from './contextControls.js';
import { updateTokenPanel, updateFileContextTokens, updateBubbleTokenCount } from './sessionTokens.js';
import { updateServiceStatus } from './serviceStatus.js';
import {
  scrollToBottomImmediate,
  shouldAutoScroll,
  setAutoScrollEnabled,
  setUserInitiatedScroll,
  scheduleScrollToBottom
} from './scrollUtils.js';
import { renderMd, injectLinks } from './markdownUtils.js';

// ==================== STATE MANAGEMENT ====================

let tokenUpdateTimer = null;

// Streaming state machine
const STREAMING_STATE = {
  IDLE: 'idle',
  PLACEHOLDER: 'placeholder',
  THINKING: 'thinking',
  ASSISTANT: 'assistant',
  TOOL_CALL: 'tool_call'
};

let currentState = STREAMING_STATE.IDLE;
let currentBubbleId = null; // The main assistant bubble id
let toolCallBuffer = '';
let regularStreamBuffer = '';
let thinkingStreamBuffer = '';
let hasReceivedChunk = false;

// Timing watchdogs
let noChunkTimer = null;
let streamStartTime = null;

// Capabilities tracking
let inThinkingBlock = false;
let thinkingTagOpen = ['<think>', '<thinking>', '<seed:think>', '[THINK]'];
let thinkingTagClose = ['</think>', '</thinking>','</seed:think>', '[/THINK]'];

// Tool call markers
const TOOL_CALL_OPEN = '[LAIToolCall]';
const TOOL_CALL_CLOSE = '[/LAIToolCall]';

// Global edit store
window.storedEdits = {};
let pendingEdits = new Map(); // bubbleId -> array of {uri, content, edits, preview}


// ==================== HELPER FUNCTIONS ====================

function getCurrentThinkingBuffer() {
  const bubbles = getThinkingBubbles();
  if (bubbles.length === 0) return '';
  const lastBubble = bubbles[bubbles.length - 1];
  return lastBubble.buffer || '';
}

function setCurrentThinkingBuffer(content) {
  setActiveThinkingBuffer(content);
}

function isThinkingTagOpen(chunk) {
  return thinkingTagOpen.some(tag => chunk.includes(tag));
}

function isThinkingTagClose(chunk) {
  return thinkingTagClose.some(tag => chunk.includes(tag));
}

function extractContentFromTags(chunk, isOpening = false) {
  let result = chunk;
  
  if (isOpening) {
    for (const tag of thinkingTagOpen) {
      const idx = result.indexOf(tag);
      if (idx !== -1) {
        result = result.slice(idx + tag.length);
        break;
      }
    }
  } else {
    for (const tag of thinkingTagClose) {
      const idx = result.indexOf(tag);
      if (idx !== -1) {
        result = result.slice(0, idx);
        break;
      }
    }
  }
  
  return result;
}

function hasPotentialTagFragment(buffer, openTags, closeTags) {
  const candidates = [...openTags, ...closeTags];
  for (const tag of candidates) {
    const max = Math.min(buffer.length, tag.length - 1);
    for (let k = 1; k <= max; k++) {
      const suffix = buffer.slice(-k);
      if (tag.startsWith(suffix)) return true;
    }
  }
  return false;
}

function transitionFromPlaceholder() {
  const placeholder = document.querySelector('.placeholder-bubble');
  if (!placeholder) return;
  
  placeholder.classList.remove('pulsing');
  placeholder.parentNode.removeChild(placeholder);
}

function finalizeCurrentBubble() {
  transitionFromPlaceholder();
  
  const assistantElem = createAssistantBubble();
  currentBubbleId = assistantElem.id;
  setStreamingState({ 
    isStreaming: true, 
    assistantElem: assistantElem, 
    assistantRaw: regularStreamBuffer 
  });
  
  if (regularStreamBuffer) {
    const body = assistantElem.querySelector('.markdown-body');
    if (body) {
      body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
      injectLinks(assistantElem);
    }
  }
}

function transitionToThinking() {
  transitionFromPlaceholder();
  
  const thinkingElem = createThinkingBubble();
  addThinkingBubble(thinkingElem);
  currentState = STREAMING_STATE.THINKING;
}

function transitionToAssistant() {
  if (currentState === STREAMING_STATE.PLACEHOLDER) {
    finalizeCurrentBubble();
  } else if (!currentBubbleId || !getStreamingState().assistantElem || currentState === STREAMING_STATE.THINKING) {
    const assistantElem = createAssistantBubble();
    currentBubbleId = assistantElem.id;
    setStreamingState({ 
      isStreaming: true, 
      assistantElem: assistantElem, 
      assistantRaw: regularStreamBuffer 
    });
  }
}


// ==================== MAIN MESSAGE ROUTER ====================

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, sessionTokens, fileContextTokens, totalTokens } = ev.data;

    switch (type) {
      case 'startStream': {
        // Reset all state
        currentState = STREAMING_STATE.PLACEHOLDER;
        hasReceivedChunk = false;
        streamStartTime = Date.now();
        regularStreamBuffer = '';
        toolCallBuffer = '';
        
        // Clear any previous thinking bubbles from DOM
        clearThinkingBubbles();

        // Create initial placeholder bubble
        const placeholderElem = createPlaceholderBubble();
        currentBubbleId = placeholderElem.id;
        setStreamingState({ 
          isStreaming: true, 
          assistantElem: placeholderElem, 
          assistantRaw: '' 
        });

        // Start watchdog for long wait message (10 seconds)
        if (noChunkTimer) clearTimeout(noChunkTimer);
        noChunkTimer = setTimeout(() => {
          if (!hasReceivedChunk && currentState === STREAMING_STATE.PLACEHOLDER) {
            const state = getStreamingState();
            if (state.assistantElem) {
              // Replace placeholder with long wait message
              const body = state.assistantElem.querySelector('.markdown-body');
              if (body) {
                body.innerHTML = `<strong>Assistant:</strong><br/>${body.innerHTML}`;
                body.classList.remove('pulsing');
                
                // Add the waiting message
                const waitMsg = document.createElement('div');
                waitMsg.className = 'long-wait-message';
                waitMsg.innerHTML = `
                  <i><span class="status-reason">&lt; LLM is taking a bit longer than expected to reply. This is normal if the model is just being loaded, or if processing large context that was just added.) &gt;</span></i>
                `;
                body.appendChild(waitMsg);
              }
            }
          }
        }, 10000);

        setUserInitiatedScroll(false);
        setAutoScrollEnabled(true);
        document.getElementById('sendButton').textContent = 'Stop';
        scrollToBottomImmediate(true);
        break;
      }

      case 'streamChunk': {
        hasReceivedChunk = true;
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }
        
        // Defensive coercion to string
        let chunk = message ?? '';
        if (typeof chunk !== 'string') {
          if (chunk && typeof chunk === 'object' && 'content' in chunk && typeof chunk.content === 'string') {
            chunk = chunk.content;
          } else {
            try { chunk = String(chunk); } catch { chunk = ''; }
          }
        }

        console.log('[MSG] Chunk received:', { 
          currentState, 
          inThinkingBlock, 
          chunkLength: chunk.length, 
          chunkPreview: chunk.substring(0, 300) 
        });

        // ========== TOOL CALL DETECTION (Highest Priority) ==========
/*         const toolOpenIdx = toolCallBuffer.indexOf(TOOL_CALL_OPEN);
        if (!toolCallBuffer.includes(TOOL_CALL_CLOSE) && toolOpenIdx !== -1) {
          currentState = STREAMING_STATE.TOOL_CALL;
          
          // Extract pre-tool text and finalize current bubble
          const preToolText = regularStreamBuffer + toolCallBuffer.slice(0, toolOpenIdx);
          if (preToolText.trim()) {
            finalizeCurrentBubble();
          }
          
          toolCallBuffer = '';
        } */

        if (currentState === STREAMING_STATE.TOOL_CALL) {
          const closeIdx = toolCallBuffer.indexOf(TOOL_CALL_CLOSE);
          if (closeIdx !== -1) {
            // Tool call complete
            const payloadStr = toolCallBuffer.slice(0, closeIdx);
            toolCallBuffer = '';
            currentState = STREAMING_STATE.ASSISTANT;
            
            // Update UI to show tool call completed
            const state = getStreamingState();
            if (state.assistantElem) {
              const body = state.assistantElem.querySelector('.markdown-body');
              if (body) {
                let header = body.querySelector('.thinking-header');
                if (!header) {
                  header = document.createElement('div');
                  header.className = 'thinking-header';
                  header.textContent = '🔧 Tool call complete';
                  body.insertBefore(header, body.firstChild);
                } else {
                  header.textContent = '🔧 Tool call complete';
                }
                
                // Add edit preview container if not exists
                let container = body.querySelector('.edit-previews-container');
                if (!container) {
                  container = document.createElement('div');
                  container.className = 'edit-previews-container';
                  body.appendChild(container);
                }
              }
            }

            // Parse and send tool request
            try {
              const normalized = payloadStr.replace(/[""']/g, '"').replace(/[''']/g, "'");
              const parsedTool = JSON.parse(normalized);
              vscode.postMessage({
                type: 'requestPreview',
                data: {
                  uri: parsedTool.uri,
                  edits: parsedTool.edits || []
                }
              });
            } catch (e) {
              console.error('Tool parse error:', e);
            }

          } else {
            // Accumulate tool payload
            toolCallBuffer += chunk;
            
            // Update UI to show receiving tool data
            const state = getStreamingState();
            if (state.assistantElem) {
              const body = state.assistantElem.querySelector('.markdown-body');
              if (body) {
                let header = body.querySelector('.thinking-header');
                if (!header) {
                  header = document.createElement('div');
                  header.className = 'thinking-header';
                  header.textContent = '🔧 Tool call in progress…';
                  body.insertBefore(header, body.firstChild);
                } else {
                  header.textContent = '🔧 Tool call in progress…';
                }
                
                let contentEl = body.querySelector('.tool-call-content');
                if (!contentEl) {
                  contentEl = document.createElement('div');
                  contentEl.className = 'tool-call-content';
                  contentEl.textContent = 'Receiving tool data…';
                  body.insertBefore(contentEl, body.firstChild);
                } else {
                  contentEl.textContent = 'Receiving tool data…';
                }
              }
            }
            
            return; // Don't process as regular stream
          }
        }
                // ========== CHECK FOR COMPLETE TAGS FIRST ==========
        if (isThinkingTagOpen(chunk)) {
          console.log('[MSG] OPENING TAG DETECTED! Creating thinking bubble...');
          console.log('[MSG] Tag chunk:', chunk.substring(0, 100));

          transitionFromPlaceholder();

          const thinkingElem = createThinkingBubble();
          addThinkingBubble(thinkingElem);

          inThinkingBlock = true;
          currentState = STREAMING_STATE.THINKING;

          console.log('[MSG] State changed to THINKING, bubble count:', getThinkingBubbles().length);

          chunk = extractContentFromTags(chunk, true);
        } else if (isThinkingTagClose(chunk) && inThinkingBlock) {
          const contentBeforeClose = extractContentFromTags(chunk, false);
          
          // Finalize the current thinking bubble with any content before close tag
          const bubbles = getThinkingBubbles();
          if (contentBeforeClose && bubbles.length > 0) {
            const lastBubble = bubbles[bubbles.length - 1];
            lastBubble.buffer += contentBeforeClose;
            setCurrentThinkingBuffer(lastBubble.buffer);
          }

          // Remove the thinking bubble and transition to assistant state
          if (bubbles.length > 0) {
            removeLastThinkingBubble();
          }
          
          // Extract any content AFTER the closing tag - this is regular response text!
          for (const closeTag of thinkingTagClose) {
            const idx = chunk.indexOf(closeTag);
            if (idx !== -1) {
              chunk = chunk.slice(idx + closeTag.length);
              break;
            }
          }
          
          // Transition to assistant state so regular response bubble appears
          transitionToAssistant();
          
          // If there's content after the tag, continue processing as regular stream
          if (!chunk.trim()) {
            return;
          }
        } else {
          console.log('[MSG] Checking for tags:', { 
            isOpeningTag: isThinkingTagOpen(chunk), 
            isClosingTag: isThinkingTagClose(chunk),
            chunkPreview: chunk.substring(0, 100) 
          });

          const combinedBuffer = regularStreamBuffer + chunk;
          const hasPartialTag = hasPotentialTagFragment(
            combinedBuffer, 
            thinkingTagOpen, 
            thinkingTagClose
          );

          if (hasPartialTag && !inThinkingBlock && currentState !== STREAMING_STATE.TOOL_CALL) {
            console.log('[MSG] Partial tag detected, buffering chunk');
            regularStreamBuffer += chunk;

            if (shouldAutoScroll) scheduleScrollToBottom();
            return;
          }
        }

        // ========== PROCESS CHUNK BASED ON STATE ==========
        console.log('[MSG] Before state processing:', { 
          inThinkingBlock, 
          bubblesCount: getThinkingBubbles().length,
          currentState,
          chunkPreview: chunk.substring(0, 100)
        });

        const currentBubbles = getThinkingBubbles();
        if (inThinkingBlock && currentBubbles.length > 0) {
          console.log('[MSG] Adding to thinking buffer');
          const lastBubble = currentBubbles[currentBubbles.length - 1];
          lastBubble.buffer += chunk;

          setCurrentThinkingBuffer(lastBubble.buffer);

          if (shouldAutoScroll) scheduleScrollToBottom();
          return; // Don't process as regular stream
        }

        // ========== SAFE TO ADD TO REGULAR STREAM ==========
        if (!chunk.includes(TOOL_CALL_OPEN) && !chunk.includes(TOOL_CALL_CLOSE)) {
          regularStreamBuffer += chunk;

          if (currentState === STREAMING_STATE.PLACEHOLDER) {
            currentState = STREAMING_STATE.ASSISTANT;
            finalizeCurrentBubble();
          }

          const state = getStreamingState();
          if (state.assistantElem && regularStreamBuffer) {
            const body = state.assistantElem.querySelector('.markdown-body');
            if (body) {
              body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
              injectLinks(state.assistantElem);
            }
          }

          if (shouldAutoScroll) scheduleScrollToBottom();
        }






        break;
      }


      case 'editPreview': {
        console.log('WEBVIEW ← editPreview', ev.data);
        const { content, uri, edits, preview } = ev.data;

        // Store globally for later use
        window.storedEdits = window.storedEdits || {};
        try {
          window.storedEdits[uri] =
            Array.isArray(edits) ? edits : typeof edits === 'string' ? JSON.parse(edits) : [];
        } catch {
          window.storedEdits[uri] = edits;
        }

        // Get the active assistant bubble
        const { assistantElem } = getStreamingState();
        if (!assistantElem) break;

        // Ensure stable id for the bubble
        const bubbleId = assistantElem.id || `bubble-${Date.now()}`;
        if (!assistantElem.id) assistantElem.id = bubbleId;

        // Create unique preview wrapper
        const previewWrapper = document.createElement('div');
        previewWrapper.className = 'edit-preview-wrapper';
        previewWrapper.dataset.previewId = `preview-${Date.now()}`;

        // Title
        const title = document.createElement('strong');
        title.textContent = `Proposed Changes for ${uri}:`;
        previewWrapper.appendChild(title);

        // JSON payload (collapsible)
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Show JSON payload (JSON lines are 0‑based)';
        const pre = document.createElement('pre');
        try {
          pre.textContent = JSON.stringify(window.storedEdits[uri], null, 2);
        } catch {
          pre.textContent = String(edits);
        }
        details.appendChild(summary);
        details.appendChild(pre);
        previewWrapper.appendChild(details);

        // After-preview (LLM's textual explanation)
        if (content) {
          const afterPre = document.createElement('pre');
          afterPre.className = 'edit-preview-after';
          afterPre.textContent = content;
          previewWrapper.appendChild(afterPre);
        }

        // Diff preview
        if (preview) {
          const diffPre = document.createElement('pre');
          diffPre.className = 'edit-preview-diff';
          diffPre.textContent = preview;
          previewWrapper.appendChild(diffPre);
        }

        // Approve / Reject buttons
        const approveBtn = document.createElement('button');
        approveBtn.className = 'approve-edit';
        approveBtn.dataset.uri = uri;
        approveBtn.textContent = 'Approve Edit';
        previewWrapper.appendChild(approveBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'reject-edit';
        rejectBtn.dataset.uri = uri;
        rejectBtn.textContent = 'Reject Edit';
        previewWrapper.appendChild(rejectBtn);

        // Click handling (only removes this wrapper)
        previewWrapper.addEventListener('click', (e) => {
          const t = e.target;
          if (!t || !t.classList) return;

          if (t.classList.contains('approve-edit')) {
            const key = t.dataset.uri;
            const payload = window.storedEdits[key];
            t.disabled = true;
            t.textContent = 'Edit Approved';
            t.classList.add('approved');

            // Remove reject button for this preview only
            const rejectBtn = previewWrapper.querySelector('.reject-edit');
            if (rejectBtn) rejectBtn.remove();

            vscode.postMessage({
              type: 'confirmEdit',
              data: { uri: key, edits: payload }
            });
          }

          if (t.classList.contains('reject-edit')) {
            const key = t.dataset.uri;
            t.disabled = true;
            t.textContent = 'Edit Rejected';
            t.classList.add('rejected');

            // Remove approve button for this preview only
            const approveBtn = previewWrapper.querySelector('.approve-edit');
            if (approveBtn) approveBtn.remove();

            vscode.postMessage({
              type: 'rejectEdit',
              data: { uri: key }
            });
          }
        });

        // Insert into bubble's edit container
        let container = assistantElem.querySelector('.edit-previews-container');
        if (!container) {
          container = document.createElement('div');
          container.className = 'edit-previews-container';
          const body = assistantElem.querySelector('.markdown-body') || assistantElem;
          body.appendChild(container);
        }
        container.appendChild(previewWrapper);

        // Keep reference for potential future use
        if (!pendingEdits.has(bubbleId)) pendingEdits.set(bubbleId, []);
        const bubblePending = pendingEdits.get(bubbleId);
        bubblePending.push({ uri, content, edits, preview });
        break;
      }

      case 'confirmEdit': {
        const { uri, edits } = ev.data;
        vscode.postMessage({
          type: 'confirmEdit',
          data: { uri, edits }
        });
        break;
      }

      //sendToAI loopback
      case 'sendToAI': {
        vscode.postMessage({
          type: 'sendToAI',
          message: ev.data.message,
          mode: ev.data.mode,
          fileContext: ev.data.fileContext,
          language: ev.data.language
        });
        break;
      }

      case 'earlyEnd': {
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }

        const state = getStreamingState();

        if (state.assistantElem) {
          const body = state.assistantElem.querySelector('.markdown-body');

          if (!hasReceivedChunk) {
            body.innerHTML = `<strong>Assistant:</strong><br/>${ev.data.reason}`;
          } else if (inThinkingBlock) {
            // Finalize any pending thinking content
            const bubbles = getThinkingBubbles();
            const lastBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;
            if (lastBubble) {
              const rendered = renderMd(lastBubble.buffer || '');
              body.innerHTML = `<strong>Assistant:</strong><br/>${rendered}`;
            }
          }

          // Clear transient visual states
          state.assistantElem.classList.remove('thinking', 'pulsing');
          state.assistantElem.classList.add('status-aborted');
        }

        // Reset flags/buffer
        inThinkingBlock = false;
        clearThinkingBubbles();
        regularStreamBuffer = '';
        toolCallBuffer = '';
        hasReceivedChunk = false;
        currentState = STREAMING_STATE.IDLE;

        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
        break;
      }

      case 'appendAssistant': {
        const { message, tokens } = ev.data;
        if (!getStreamingState().isStreaming && message && typeof tokens === 'number') {
          appendBubble(message, 'ai-message', tokens);
        }
        break;
      }

      case 'endStream':
      case 'stoppedStream': {
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }

        const state = getStreamingState();

        if (state.assistantElem) {
          // Clear visual states but keep content
          state.assistantElem.classList.remove('thinking', 'pulsing');

          const body = state.assistantElem.querySelector('.markdown-body');
          
          if (!hasReceivedChunk && body) {
            body.innerHTML = `<strong>Assistant:</strong><i><br/>
              <span class="status-reason">&lt; No response received from LLM. Verify the URL, API, and model are correct. &gt;</span>`;
            if (shouldAutoScroll) {
              scrollToBottomImmediate(true);
            }
          } else if (body && currentState === STREAMING_STATE.TOOL_CALL) {
            const header = body.querySelector('.thinking-header');
            if (header) header.textContent = '🔧 Tool call complete';
          }
        }

        // Finalize any pending thinking blocks
        while (getThinkingBubbles().length > 0) {
          removeLastThinkingBubble();
        }

        inThinkingBlock = false;
        regularStreamBuffer = '';
        toolCallBuffer = '';
        hasReceivedChunk = false;
        currentState = STREAMING_STATE.IDLE;

        // End stream but keep the assistant bubble reference
        setStreamingState({ isStreaming: false, assistantElem: state.assistantElem, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
        break;
      }

      case 'appendUser': {
        const { message, chatTokens, fileTokens } = ev.data;
        if (message && typeof chatTokens === 'number') {
          appendBubble(message, 'user-message', chatTokens, fileTokens || 0);
        }
        break;
      }

      case 'fileContextTokens':
        updateFileContextTokens(ev.data.tokens, contextSize);
        break;

      case 'streamTokenUpdate': {
        const state = getStreamingState();
        if (state.assistantElem && typeof ev.data.tokens === 'number') {
          // Update token count on the assistant bubble
          updateBubbleTokenCount(state.assistantElem, ev.data.tokens, ev.data.tps);
        }
        break;
      }

      case 'finalizeAI': {
        const state = getStreamingState();
        const { tokens, tps } = ev.data;
        
        if (state.assistantElem && typeof tokens === 'number') {
          // Check if token count already exists to avoid duplicates
          const existingTokenDiv = state.assistantElem.querySelector('.token-count');
          if (!existingTokenDiv) {
            updateBubbleTokenCount(state.assistantElem, tokens, tps);
            
            if (shouldAutoScroll) scrollToBottomImmediate(true);
          } else {
            // Update existing token count
            updateBubbleTokenCount(state.assistantElem, tokens, tps);
          }
        }
        
        // Finalize any pending thinking blocks
        while (getThinkingBubbles().length > 0) {
          removeLastThinkingBubble();
        }
        
        currentState = STREAMING_STATE.IDLE;
        break;
      }

      case 'setModel': {
        const modelSpan = document.getElementById('modelNameBox');
        if (modelSpan) {
          const displayName = ev.data.value?.trim() || 'None';
          modelSpan.textContent =  displayName;
          modelSpan.onclick = () => {
            vscode.postMessage({ type: 'invokeCommand', command: 'extension.selectModel' });
          };
        }
        break;
      }

      case 'setApiType': {
        const apiTypeSpan = document.getElementById('apiTypeBox');
        if (apiTypeSpan) {
          const displayName = ev.data.value?.trim() || 'None';
          apiTypeSpan.textContent = displayName;
          apiTypeSpan.onclick = () => {
            vscode.postMessage({ type: 'invokeCommand', command: 'extension.selectApiType' });
          };
        }
        break;
      }

      case 'setLLMUrl': {
        const urlSpan = document.getElementById('llmURLBox');
        if (urlSpan) {
          const displayUrl = ev.data.value?.trim() || 'None';
          urlSpan.textContent =  displayUrl;
          urlSpan.onclick = () => {
            vscode.postMessage({ type: 'invokeCommand', command: 'extension.setApiURL' });
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

      case 'sessionTokenUpdate':
        updateTokenPanel({ sessionTokens, fileContextTokens, totalTokens }, contextSize);
        break;

      case 'apiReachability':
        updateServiceStatus(ev.data.value);
        break;

      case 'codeValidated':
      case 'codeInput':
        scrollToBottomImmediate(true);
        break;

      case 'stopStream': {
        if (noChunkTimer) { 
          clearTimeout(noChunkTimer); 
          noChunkTimer = null; 
        }

        const state = getStreamingState();
        
        // Finalize any pending thinking blocks
        while (getThinkingBubbles().length > 0) {
          removeLastThinkingBubble();
        }

        if (state.assistantElem) {
          // Remove visual states and any placeholder text
          state.assistantElem.classList.remove('thinking', 'pulsing');

          // If no chunks were received, update the message to reflect user stopping
          if (!hasReceivedChunk && toolCallBuffer) {
            const body = state.assistantElem.querySelector('.markdown-body');
            if (body) {
              let pretty = toolCallBuffer;
              try {
                const normalized = toolCallBuffer.replace(/[""']/g, '"').replace(/[''']/g, "'");
                const parsed = JSON.parse(normalized);
                if (parsed && Array.isArray(parsed.edits)) {
                  const display = {
                    ...parsed,
                    edits: parsed.edits.map(e => ({
                      ...e,
                      start: {
                        ...e.start,
                        line: (typeof e.start?.line === 'number') ? e.start.line + 1 : e.start?.line
                      },
                      end: {
                        ...e.end,
                        line: (typeof e.end?.line === 'number') ? e.end.line + 1 : e.end?.line
                      }
                    }))
                  };
                  pretty = JSON.stringify(display, null, 2);
                } else {
                  pretty = JSON.stringify(parsed, null, 2);
                }
              } catch {
                // fallback to raw buffer if parse fails
                pretty = toolCallBuffer;
              }

              body.innerHTML = `
                <div class="thinking-header">🔧 Tool call complete</div>
                <details>
                  <summary>Show JSON payload (lines in JSON payload are 0-based)</summary>
                  <pre>${pretty.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                </details>
              `;
            }
          }
        }

        // Reset state
        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        
        // Reset send button text
        document.getElementById('sendButton').textContent = 'Send';
        scrollToBottomImmediate(true);
      }

      //update context file list in UI
      case 'contextUpdated': {
        updateContextFileList(vscode, ev.data.files);
        break;
      }

      case 'invokeCommand':
        // This type is handled by the extension host, not the webview router.
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  });
}
