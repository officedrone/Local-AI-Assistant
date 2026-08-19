// src/static/webviewScripts/messageRouter.js
import { 
  appendBubble, 
  getStreamingState, 
  setStreamingState,
  createPlaceholderBubble,
  createThinkingBubble,
  createAssistantBubble,
  createToolBubble,           // NEW: Tool bubble UI
  addThinkingBubble,
  addToolBubble,              // NEW: Track tool bubbles
  removeLastThinkingBubble,
  setActiveThinkingBuffer,
  getActiveThinkingBuffer,
  updateToolBubblePayload,    // NEW: Update JSON payload display
  markToolExecuting,          // NEW: Show executing state
  closeToolBubble,            // NEW: Close tool bubble with result
  getActiveToolBubble,        // NEW: Get active tool bubble
  clearThinkingBubbles,
  clearToolBubbles,           // NEW: Clear all tool bubbles
  createRetryBubble,          // NEW: Retry feedback bubbles
  formatToolName,             // NEW: Format tool names for display
  updateToolBubbleTitle,      // NEW: Update tool title after JSON parsed
  getThinkingBubbles,
  appendToolResultBubble
} from './chat.js';
import { updateContextFileList } from './contextControls.js';
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

// Helper functions for indicators
function hideReadingIndicator() {
  const indicators = document.querySelectorAll('.reading-indicator');
  indicators.forEach(ind => {
    if (ind.parentNode) ind.parentNode.removeChild(ind);
  });
}

function hideSearchIndicator() {
  const indicators = document.querySelectorAll('.search-indicator');
  indicators.forEach(ind => {
    if (ind.parentNode) ind.parentNode.removeChild(ind);
  });
}

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
let activeToolBubbleId = null; // NEW: Track active tool bubble ID
let toolCallBuffer = '';
let regularStreamBuffer = '';
let thinkingStreamBuffer = '';
let hasReceivedChunk = false;

// Tool retry tracking (for automatic retries on failure)
const MAX_TOOL_RETRIES = 2;

// Timing watchdogs
let noChunkTimer = null;
let streamStartTime = null;

// Capabilities tracking
let inThinkingBlock = false;
let thinkingTagOpen = ['<think>', '<thinking>', '<seed:think>', '[THINK]'];
let thinkingTagClose = ['</think>', '</thinking>','</seed:think>', '[/THINK]'];

// Tool call markers - using standard XML tags
const TOOL_CALL_OPEN = '<tool>';
const TOOL_CALL_CLOSE = '</tool>';

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
  // ALWAYS remove placeholder first if present
  if (currentState === STREAMING_STATE.PLACEHOLDER) {
    transitionFromPlaceholder();
  }
  
  const currentBubbleExists = getStreamingState().assistantElem;
  
  if (!currentBubbleExists || currentState === STREAMING_STATE.THINKING) {
    const assistantElem = createAssistantBubble();
    currentBubbleId = assistantElem.id;
    setStreamingState({ 
      isStreaming: true, 
      assistantElem: assistantElem, 
      assistantRaw: regularStreamBuffer 
    });
  }
  
  currentState = STREAMING_STATE.ASSISTANT;
}


// ==================== MAIN MESSAGE ROUTER ====================

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, sessionTokens, fileContextTokens, toolsTokens, totalTokens } = ev.data;

    switch (type) {
      case 'startStream': {
        console.log(`[Dev-Tool] startStream received - starting new stream, currentState=${currentState}`);
        
        // Check if we have an existing assistant bubble to remove (from previous tool call cycle)
        const existingAssistant = getStreamingState().assistantElem;
        if (existingAssistant && existingAssistant.parentNode) {
          console.log(`[Dev-Tool] Removing previous assistant bubble for new stream cycle`);
          // Remove the old assistant bubble from DOM
          existingAssistant.parentNode.removeChild(existingAssistant);
        }
        
        // Reset all state for a fresh stream cycle
        currentState = STREAMING_STATE.PLACEHOLDER;
        hasReceivedChunk = false;
        streamStartTime = Date.now();
        regularStreamBuffer = '';
        toolCallBuffer = '';
        activeToolBubbleId = null;
        inThinkingBlock = false;  // CRITICAL: Reset thinking block flag for new stream
        
        console.log(`[Dev-Tool] Clearing previous bubbles for new stream cycle`);
        
        // Always clear thinking/tool bubbles from DOM before starting fresh
        clearThinkingBubbles();
        clearToolBubbles();

        // Create a NEW placeholder bubble for each stream cycle (including tool result continuations)
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
        // Button state managed by syncStreamingState message
        scrollToBottomImmediate(true);
        break;
      }

      case 'streamChunk': {
        console.log(`[Dev-Tool] streamChunk RECEIVED - chunk length=${message?.length || 0}, currentState=${currentState}`);
        
        // Debug: Log first few chunks with content preview
        if (!window.chunkCount) window.chunkCount = 0;
        window.chunkCount++;
        const shouldLogContent = window.chunkCount <= 5;
        if (shouldLogContent) {
          console.log(`[Dev-Tool] CHUNK #${window.chunkCount} CONTENT: "${message?.substring(0, 100)}"`);
          console.log(`[Dev-Tool] Contains <thinking>: ${message?.includes('<thinking>')}`);
          console.log(`[Dev-Tool] Contains </thinking>: ${message?.includes('</thinking>')}`);
        }
        
        const chunkLength = message?.length || 0;
        console.log(`[Dev-Tool] streamChunk received - chunk length: ${chunkLength}, currentState: ${currentState}`);
        console.log(`[Dev-Tool] Buffers before adding: regular=${regularStreamBuffer.length}, toolCall=${toolCallBuffer.length}`);
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

        // ========== TOOL CALL DETECTION (Highest Priority) ==========
        const wasInToolCall = currentState === STREAMING_STATE.TOOL_CALL;

        // ========== TOOL CALL DETECTION (HIGHEST PRIORITY - COMBINED BUFFER) ==========

        const combinedBeforeTool = regularStreamBuffer + chunk;
        const toolOpenIdx = combinedBeforeTool.indexOf(TOOL_CALL_OPEN);

        console.log(`[Dev-Tool] Checking for tool tag in combined buffer: toolOpenIdx=${toolOpenIdx}, wasInToolCall=${wasInToolCall}`);

        if (!wasInToolCall && toolOpenIdx !== -1) {
          const textBeforeTool = combinedBeforeTool.slice(0, toolOpenIdx);
          
            console.log(`[Dev-Tool] Opening tag found at index ${toolOpenIdx}, text before length=${textBeforeTool.length}`);
            
            // Log if this is during a continuation (check for assistant bubble with tool call)
            const hasPreviousToolCall = regularStreamBuffer.includes('<tool>');
            console.log(`[Dev-Tool] Previous content contains tool tag: ${hasPreviousToolCall}`);
          
          // Only finalize and create assistant bubble if we're in PLACEHOLDER state (no active bubble yet)
          // If already in ASSISTANT state, the bubble exists and we just need to update its content
          const currentBubbleExists = getStreamingState().assistantElem;
          
          if (textBeforeTool.trim()) {
            regularStreamBuffer = textBeforeTool;
            
            // Only create/update assistant bubble if it doesn't exist yet OR we're in placeholder state
            if (!currentBubbleExists || currentState === STREAMING_STATE.PLACEHOLDER) {
              finalizeCurrentBubble();
            } else {
              // Update existing assistant bubble with text before tool
              const state = getStreamingState();
              if (state.assistantElem) {
                const body = state.assistantElem.querySelector('.markdown-body');
                if (body) {
                  body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
                  injectLinks(state.assistantElem);
                }
              }
            }
          } else {
            regularStreamBuffer = '';
            
            // If no text before tool but we have a placeholder, remove it
            if (currentState === STREAMING_STATE.PLACEHOLDER) {
              transitionToAssistant();
            }
          }
          
          // Extract content after opening tag
          const afterOpeningTag = combinedBeforeTool.slice(toolOpenIdx + TOOL_CALL_OPEN.length);
          
          console.log(`[Dev-Tool] Content after <tool>: length=${afterOpeningTag.length}, starts with="${afterOpeningTag.substring(0, 50)}", ends with="${afterOpeningTag.substring(Math.max(0, afterOpeningTag.length - 20))}"`);
          
          // Check if closing tag is also present (complete tool call in one go)
          const closeIdx = afterOpeningTag.indexOf(TOOL_CALL_CLOSE);
          
          if (closeIdx !== -1) {
            // COMPLETE tool call! Process immediately
            
            const payloadStr = afterOpeningTag.slice(0, closeIdx);
            
            currentState = STREAMING_STATE.TOOL_CALL;
            const toolBubble = createToolBubble('Unknown');
            activeToolBubbleId = toolBubble.id;
            addToolBubble(toolBubble);
            
            // Log if we're in a thinking block (for debugging)
            if (inThinkingBlock) {
              console.log(`[Dev-Tool] Tool detected inside thinking block`);
            }
            
            const result = processToolCall(payloadStr, activeToolBubbleId);
            
            if (result.success) {
              // Extract post-tool content (after closing tag)
              const postToolContent = afterOpeningTag.slice(closeIdx + TOOL_CALL_CLOSE.length);
              
              currentState = STREAMING_STATE.ASSISTANT;
              toolCallBuffer = '';
              
              // CRITICAL: Remove placeholder before creating assistant bubble
              if (currentState === STREAMING_STATE.PLACEHOLDER) {
                transitionFromPlaceholder();
              }
              
              if (postToolContent.trim()) {
                regularStreamBuffer = postToolContent;
                // Continue to regular stream processing below
              } else {
                transitionToAssistant();
                return;
              }
            } else {
              // Parse error - already handled in processToolCall
              currentState = STREAMING_STATE.ASSISTANT;
              activeToolBubbleId = null;
              toolCallBuffer = '';
              return;
            }
          } else {
            // INCOMPLETE tool call, start accumulating
            console.log(`[Dev-Tool] Tool tag detected, starting accumulation`);
            
            currentState = STREAMING_STATE.TOOL_CALL;
            const toolBubble = createToolBubble('Unknown');
            activeToolBubbleId = toolBubble.id;
            addToolBubble(toolBubble);
            
            toolCallBuffer = afterOpeningTag;
            
            return; // Wait for more chunks
          }
        }

        console.log(`[Dev-Tool] No tool tag in combined buffer, continuing...`);

        // Handle tool call accumulation and completion
        if (currentState === STREAMING_STATE.TOOL_CALL) {
          const closeIdx = toolCallBuffer.indexOf(TOOL_CALL_CLOSE);
          
          if (closeIdx !== -1) {
            // ===== TOOL CALL COMPLETE =====
            const payloadStr = toolCallBuffer.slice(0, closeIdx);
            toolCallBuffer = '';
            
            console.log(`[Dev-Tool] Tool call complete, payload length=${payloadStr.length}`);

            // Update tool bubble with final payload
            updateToolBubblePayload(activeToolBubbleId, payloadStr);
            markToolExecuting(activeToolBubbleId);
            
            // Parse and execute tool
            let parsedTool;
            try {
              console.log(`[Dev-Tool] Parsing JSON payload`);
              parsedTool = JSON.parse(payloadStr);
              console.log(`[Dev-Tool] JSON parsed successfully: ${parsedTool.type || parsedTool.tool}`);
              
              // Determine tool type for display
              const toolType = parsedTool.type || parsedTool.tool;
              if (toolType) {
                updateToolBubbleTitle(activeToolBubbleId, toolType);
              }
              
              // Dispatch to appropriate handler
              dispatchToolCallToExtension(parsedTool);
              
            } catch (e) {
              console.error(`[Dev-Tool] JSON parse error: ${e.message}`);
              // JSON parse error - show in bubble and send back to LLM
              closeToolBubble(activeToolBubbleId, `JSON Parse Error: ${e.message}`, true);
              
              // Send error to LLM for retry
              vscode.postMessage({
                type: 'toolResultToLLM',
                toolType: parsedTool?.type || 'Unknown',
                success: false,
                error: `JSON Parse Error: ${e.message}`,
                summary: 'Failed to parse tool call JSON'
              });
              
              // Transition to assistant state for next response
              currentState = STREAMING_STATE.ASSISTANT;
              activeToolBubbleId = null;
              return;
            }
            
            console.log(`[Dev-Tool] Tool call complete, payload parsed`);

            // Extract any content AFTER </tool> tag from toolCallBuffer (not chunk)
            const postToolContent = toolCallBuffer.slice(closeIdx + TOOL_CALL_CLOSE.length);
            
            // Keep bubble in executing state - don't close yet! 
            // The bubble will stay visible with spinner until extension returns result
            console.log(`[Dev-Tool] markToolExecuting: keeping bubble active for ${activeToolBubbleId}`);
            markToolExecuting(activeToolBubbleId); // Ensure spinner shows and "Executing..." message appears

            // DO NOT set activeToolBubbleId to null - keep it tracked so toolResultToLLM can find it!
            console.log(`[Dev-Tool] Tool state: currentState=TOOL_CALL → ASSISTANT, activeToolBubbleId=${activeToolBubbleId}`);
            
            // Process post-tool content as regular assistant text
            if (postToolContent.trim()) {
              currentState = STREAMING_STATE.ASSISTANT;
              
              // CRITICAL: Remove placeholder before creating assistant bubble
              if (getStreamingState().assistantElem && getStreamingState().assistantElem.classList.contains('placeholder-bubble')) {
                transitionFromPlaceholder();
              }
              
              // Only create new assistant bubble if one doesn't exist yet
              // If we already have an assistant bubble from text before the tool, reuse it
              if (!getStreamingState().assistantElem) {
                const assistantElem = createAssistantBubble();
                currentBubbleId = assistantElem.id;
                setStreamingState({ 
                  isStreaming: true, 
                  assistantElem: assistantElem, 
                  assistantRaw: postToolContent 
                });
              }
              
              const state = getStreamingState();
              if (state.assistantElem) {
                const body = state.assistantElem.querySelector('.markdown-body');
                if (body) {
                  regularStreamBuffer = postToolContent;
                  body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
                  injectLinks(state.assistantElem);
                }
              }
            } else {
              // No post-tool content - transition to assistant for next chunks
              currentState = STREAMING_STATE.ASSISTANT;
              
              // CRITICAL: Remove placeholder before creating assistant bubble
              if (getStreamingState().assistantElem && getStreamingState().assistantElem.classList.contains('placeholder-bubble')) {
                transitionFromPlaceholder();
              }
              
              // Create assistant bubble if one doesn't exist yet
              if (!getStreamingState().assistantElem) {
                const assistantElem = createAssistantBubble();
                currentBubbleId = assistantElem.id;
                setStreamingState({ 
                  isStreaming: true, 
                  assistantElem: assistantElem, 
                  assistantRaw: regularStreamBuffer 
                });
              }
            }
            
          } else {
            // ===== TOOL CALL IN PROGRESS (accumulate more chunks) =====
            const prevLength = toolCallBuffer.length;
            toolCallBuffer += chunk;
            
            console.log(`[Dev-Tool] Accumulating: prev=${prevLength}, added=${chunk.length}, total=${toolCallBuffer.length}`);
            console.log(`  Last 30 chars: "${toolCallBuffer.slice(-30)}"`);
            console.log(`  First 50 chars: "${toolCallBuffer.substring(0, 50)}"`);
            
            // Check if closing tag just arrived
            const closeIdx = toolCallBuffer.indexOf(TOOL_CALL_CLOSE);
            if (closeIdx !== -1) {
              console.log(`[Dev-Tool] Closing tag found after accumulation! Position: ${closeIdx}`);
              // Re-process this iteration to handle completion
              const payloadStr = toolCallBuffer.slice(0, closeIdx);
              const postToolContent = toolCallBuffer.slice(closeIdx + TOOL_CALL_CLOSE.length);
              
              console.log(`[Dev-Tool] Payload length: ${payloadStr.length}`);
              console.log(`[Dev-Tool] Post-tool content length: ${postToolContent.length}`);
              
              // Update bubble with final payload before processing
              updateToolBubblePayload(activeToolBubbleId, payloadStr);
              markToolExecuting(activeToolBubbleId);
              
              let parsedTool;
              try {
                console.log(`[Dev-Tool] Parsing JSON payload`);
                parsedTool = JSON.parse(payloadStr);
                const toolType = parsedTool.type || parsedTool.tool;
                if (toolType) {
                  updateToolBubbleTitle(activeToolBubbleId, toolType);
                }
                
                dispatchToolCallToExtension(parsedTool);
                
              } catch (e) {
                console.error(`[Dev-Tool] JSON parse error: ${e.message}`);
                closeToolBubble(activeToolBubbleId, `JSON Parse Error: ${e.message}`, true);
                activeToolBubbleId = null; // Clear after closing on parse error
                
                vscode.postMessage({
                  type: 'toolResultToLLM',
                  toolType: parsedTool?.type || 'Unknown',
                  success: false,
                  error: `JSON Parse Error: ${e.message}`,
                  summary: 'Failed to parse tool call JSON'
                });
                
                currentState = STREAMING_STATE.ASSISTANT;
                toolCallBuffer = '';
                return;
              }
              
              console.log(`[Dev-Tool] Tool call complete, payload parsed`);
              
              // Keep bubble in executing state - DON'T clear activeToolBubbleId yet!
              markToolExecuting(activeToolBubbleId);

              currentState = STREAMING_STATE.ASSISTANT;
              // activeToolBubbleId stays tracked until result returns in toolResultToLLM
              toolCallBuffer = '';
              
              if (postToolContent.trim()) {
                regularStreamBuffer = postToolContent;
                
                // CRITICAL: Remove placeholder before creating assistant bubble
                if (getStreamingState().assistantElem && getStreamingState().assistantElem.classList.contains('placeholder-bubble')) {
                  transitionFromPlaceholder();
                }
                
                // Only create new assistant bubble if one doesn't exist yet
                if (!getStreamingState().assistantElem) {
                  const assistantElem = createAssistantBubble();
                  currentBubbleId = assistantElem.id;
                  setStreamingState({ 
                    isStreaming: true, 
                    assistantElem: assistantElem, 
                    assistantRaw: regularStreamBuffer 
                  });
                }
                
                const state = getStreamingState();
                if (state.assistantElem) {
                  const body = state.assistantElem.querySelector('.markdown-body');
                  if (body) {
                    body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
                    injectLinks(state.assistantElem);
                  }
                }
              } else {
                // CRITICAL: Remove placeholder before creating assistant bubble
                if (getStreamingState().assistantElem && getStreamingState().assistantElem.classList.contains('placeholder-bubble')) {
                  transitionFromPlaceholder();
                }
                
                // Only create assistant bubble if one doesn't exist yet
                if (!getStreamingState().assistantElem) {
                  const assistantElem = createAssistantBubble();
                  currentBubbleId = assistantElem.id;
                  setStreamingState({ 
                    isStreaming: true, 
                    assistantElem: assistantElem, 
                    assistantRaw: regularStreamBuffer 
                  });
                }
              }
              
              return; // Done processing this chunk with closing tag
            }
            
            // Update bubble with accumulated content
            updateToolBubblePayload(activeToolBubbleId, toolCallBuffer);
            
            return; // Don't process as regular stream
          }
        }

        // Helper: Dispatch parsed tool to extension host
        function dispatchToolCallToExtension(parsedTool) {
          const toolType = parsedTool.type || parsedTool.tool;
          
          if (parsedTool.type === 'requestFileContent' || parsedTool.tool === 'requestFileContent') {
            // Add default line range if not specified - get entire file
            const startLine = parsedTool.startLine ?? parsedTool.start ?? 0;
            const endLine = parsedTool.endLine ?? parsedTool.end ?? 999999;
            
            vscode.postMessage({
              type: 'requestFileContent',
              uri: parsedTool.uri,
              startLine: startLine,
              endLine: endLine
            });
          } else if (parsedTool.type === 'searchInFile') {
            vscode.postMessage({
              type: 'searchInFile',
              query: parsedTool.query,
              scope: parsedTool.scope || 'context', // Default to 'context' instead of 'workspace'
              maxResults: parsedTool.maxResults || 5
            });
          } else if (parsedTool.type === 'editFile' || parsedTool.uri) {
            vscode.postMessage({
              type: 'requestPreview',
              data: {
                uri: parsedTool.uri,
                edits: parsedTool.edits || []
              }
            });
          } else if (parsedTool.tool === 'requestFileContent') {
            // Legacy format support
            vscode.postMessage({
              type: 'requestFileContent',
              uri: parsedTool.uri,
              startLine: parsedTool.startLine || parsedTool.start,
              endLine: parsedTool.endLine || parsedTool.end
            });
          } else if (parsedTool.tool === 'editFile') {
            // Legacy format support
            vscode.postMessage({
              type: 'requestPreview',
              data: {
                uri: parsedTool.uri,
                edits: parsedTool.edits || []
              }
            });
          } else {
            console.warn('Unknown tool call type:', toolType);
          }
        }

        /**
         * Process a complete tool call payload
         * @param {string} payloadStr - JSON payload string  
         * @param {string} bubbleId - Tool bubble ID to update
         * @returns {{ success: boolean, error?: string, parsedTool?: object }}
         */
        function processToolCall(payloadStr, bubbleId) {
          console.log(`[Dev-Tool] Processing tool call, payload length=${payloadStr.length}`);

          // Update tool bubble with final payload
          updateToolBubblePayload(bubbleId, payloadStr);
          markToolExecuting(bubbleId);
          
          let parsedTool;
          try {
            parsedTool = JSON.parse(payloadStr);
            const toolType = parsedTool.type || parsedTool.tool;
            if (toolType) {
              updateToolBubbleTitle(bubbleId, toolType);
            }
            
            dispatchToolCallToExtension(parsedTool);
            return { success: true, parsedTool };
            
            } catch (e) {
              console.error(`[Dev-Tool] JSON parse error: ${e.message}`);
              
              closeToolBubble(activeToolBubbleId, `JSON Parse Error: ${e.message}`, true);
              activeToolBubbleId = null; // Clear after closing on parse error
              
              vscode.postMessage({
                type: 'toolResultToLLM',
                toolType: parsedTool?.type || 'Unknown',
                success: false,
                error: `JSON Parse Error: ${e.message}`,
                summary: 'Failed to parse tool call JSON'
              });
              
              // Transition to assistant state for next response
              currentState = STREAMING_STATE.ASSISTANT;
              return;
            }
        }

                // ========== CHECK FOR COMPLETE TAGS FIRST (WITH COMBINED BUFFER) ==========
        
        const combinedBuffer = regularStreamBuffer + chunk;
        
        // Check for thinking tag in combined buffer (handles split tags across chunks)
        let thinkingTagIdx = -1;
        let matchedThinkingTag = null;
        if (!inThinkingBlock && !wasInToolCall) {
          // Search for opening tags
          for (const tag of thinkingTagOpen) {
            const idx = combinedBuffer.indexOf(tag);
            if (idx !== -1) {
              thinkingTagIdx = idx;
              matchedThinkingTag = tag;
              break;
            }
          }
        } else if (inThinkingBlock && !wasInToolCall) {
          // Search for closing tags
          for (const tag of thinkingTagClose) {
            const idx = combinedBuffer.indexOf(tag);
            if (idx !== -1) {
              thinkingTagIdx = idx;
              matchedThinkingTag = tag;
              break;
            }
          }
        }

        if (thinkingTagIdx !== -1 && !wasInToolCall) {
          const textBeforeTag = combinedBuffer.slice(0, thinkingTagIdx);
          
          if (!inThinkingBlock) {
            // Opening thinking tag found
            transitionFromPlaceholder();

            const thinkingElem = createThinkingBubble();
            addThinkingBubble(thinkingElem);

            inThinkingBlock = true;
            currentState = STREAMING_STATE.THINKING;

            // Extract content after opening tag and continue processing
            chunk = combinedBuffer.slice(thinkingTagIdx + matchedThinkingTag.length);
          } else {
            // Closing thinking tag found
            const contentBeforeClose = combinedBuffer.slice(textBeforeTag.length, thinkingTagIdx);
            
            // Finalize the current thinking bubble with any content before close tag
            const bubbles = getThinkingBubbles();
            if (contentBeforeClose && bubbles.length > 0) {
              const lastBubble = bubbles[bubbles.length - 1];
              lastBubble.buffer += extractContentFromTags(contentBeforeClose, false);
              setCurrentThinkingBuffer(lastBubble.buffer);
            }

            // Remove the thinking bubble and transition to assistant state
            if (bubbles.length > 0) {
              removeLastThinkingBubble();
            }
            
            // Extract any content AFTER the closing tag - this is regular response text!
            chunk = combinedBuffer.slice(thinkingTagIdx + matchedThinkingTag.length);
            
            // Transition to assistant state so regular response bubble appears
            transitionToAssistant();
            
            // If there's no content after the tag, return early
            if (!chunk.trim()) {
              return;
            }
          }
        } else {
          // No complete thinking tag found - check for partial tags to avoid rendering incomplete markup
           const hasPartialTag = hasPotentialTagFragment(
             combinedBuffer, 
             [...thinkingTagOpen, TOOL_CALL_OPEN], 
             [...thinkingTagClose, TOOL_CALL_CLOSE]
           );

           if (hasPartialTag && !inThinkingBlock && currentState !== STREAMING_STATE.TOOL_CALL) {
            regularStreamBuffer += chunk;

            if (shouldAutoScroll) scheduleScrollToBottom();
            return;
          }
        }

        const currentBubbles = getThinkingBubbles();
        if (inThinkingBlock && currentBubbles.length > 0) {
          const lastBubble = currentBubbles[currentBubbles.length - 1];
          lastBubble.buffer += chunk;

          setCurrentThinkingBuffer(lastBubble.buffer);

          if (shouldAutoScroll) scheduleScrollToBottom();
          return; // Don't process as regular stream
        }

        // ========== SAFE TO ADD TO REGULAR STREAM ==========
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
            
            // Force reflow to ensure scroll calculations are accurate
            void body.offsetHeight;
          }
        }

        if (shouldAutoScroll) scheduleScrollToBottom();






        break;
      }


      case 'editPreview': {
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

      case 'editResult': {
        const { uri, success, error } = ev.data;
        
        console.log(`[Dev-Tool] editResult received: uri=${uri}, success=${success}`);
        
        // Close/collapse the active tool bubble regardless of success/failure
        const activeTool = getActiveToolBubble();
        if (activeTool) {
          let resultSummary, resultContent;
          
          if (!success) {
            console.error(`[Dev-Tool] Edit failed: ${error}`);
            resultSummary = `Edit failed for ${uri}`;
            resultContent = `// Error applying edit to ${uri}: ${error || 'Unknown error'}`;
            closeToolBubble(activeTool.id, error || 'Edit failed', true);
          } else {
            console.log(`[Dev-Tool] Edit succeeded`);
            resultSummary = `Edit applied successfully to ${uri.split('/').pop() || uri}`;
            resultContent = `// Edit applied to file: ${uri}\n// Changes have been made to the file as requested.`;
            closeToolBubble(activeTool.id, resultSummary, false);
          }
          
          // Create collapsed assistant bubble showing what was done
          appendToolResultBubble('editFile', resultSummary, resultContent);
          
          // Send the edit result back to the LLM so it can continue
          console.log(`[Dev-Tool] Sending sendToAI for edit result`);
          vscode.postMessage({
            type: 'sendToAI',
            message: resultContent,
            mode: 'chat',
            language: '',
            isToolResult: true
          });
        } else {
          console.warn('[Dev-Tool] No active tool bubble found for editResult');
        }
        
        break;
      }

      case 'rejectEdit': {
        const { uri } = ev.data;
        
        console.log(`[Dev-Tool] rejectEdit received: uri=${uri}`);
        
        // Close/collapse the active tool bubble when edit is rejected
        const activeTool = getActiveToolBubble();
        if (activeTool) {
          const resultSummary = `Edit rejected for ${uri.split('/').pop() || uri}`;
          const resultContent = `// Edit was rejected by user - no changes made to ${uri}`;
          
          closeToolBubble(activeTool.id, resultSummary, false);
          
          // Create collapsed assistant bubble showing what was done
          appendToolResultBubble('editFile', resultSummary, resultContent);
          
          // Send the rejection back to the LLM so it can try something else
          console.log(`[Dev-Tool] Sending sendToAI for edit rejection`);
          vscode.postMessage({
            type: 'sendToAI',
            message: resultContent,
            mode: 'chat',
            language: '',
            isToolResult: true
          });
        } else {
          console.warn('[Dev-Tool] No active tool bubble found for rejectEdit');
        }
        
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
        // Button state managed by syncStreamingState message
        break;
      }

      case 'appendAssistant': {
        const { message, tokens } = ev.data;
        if (!getStreamingState().isStreaming && message && typeof tokens === 'number') {
          appendBubble(message, 'ai-message', tokens);
        }
        break;
      }

      case 'syncStreamingState': {
        // Sync button state with backend streaming flag
        const isActive = ev.data.active;
        console.log(`[Dev-Tool] syncStreamingState: active=${isActive}`);
        document.getElementById('sendButton').textContent = isActive ? 'Stop' : 'Send';
        break;
      }

      case 'endStream':
      case 'stoppedStream': {
        console.log(`[Dev-Tool] ${ev.data.type} received - hasReceivedChunk=${hasReceivedChunk}`);
        console.log(`[Dev-Tool] Buffer lengths: regular=${regularStreamBuffer.length}, toolCall=${toolCallBuffer.length}`);
        console.log(`[Dev-Tool] Current state: ${currentState}, activeToolBubbleId: ${activeToolBubbleId}`);
        
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }

        const state = getStreamingState();

        if (state.assistantElem) {
          // Clear visual states but keep content
          state.assistantElem.classList.remove('thinking', 'pulsing');

          const body = state.assistantElem.querySelector('.markdown-body');
          
          // Check if we actually have content, even if hasReceivedChunk is false
          const combinedContent = regularStreamBuffer + toolCallBuffer;
          
          if (!hasReceivedChunk && !combinedContent && body) {
            console.log(`[Dev-Tool] No chunks received AND no buffer content - keeping placeholder visible`);
            // Don't show error immediately - let the watchdog timer handle long waits
            // This can happen when LLM processes tool results quickly or returns empty thinking
          } else if (!hasReceivedChunk && combinedContent && body) {
            // We have content but hasReceivedChunk is false - this shouldn't happen!
            console.warn(`[Dev-Tool] BUG: Has buffer content (${combinedContent.length} chars) but hasReceivedChunk=false`);
            // Show the actual content instead of error message
            if (currentState === STREAMING_STATE.TOOL_CALL && toolCallBuffer) {
              body.innerHTML = `<strong>Assistant:</strong><br/>${toolCallBuffer}`;
            } else {
              body.innerHTML = `<strong>Assistant:</strong><br/>${renderMd(regularStreamBuffer)}`;
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

        // Handle incomplete tool call on stream interruption
        if (currentState === STREAMING_STATE.TOOL_CALL && activeToolBubbleId) {
          console.log(`[Dev-Tool] Stream interrupted with incomplete tool call`);
          
          closeToolBubble(activeToolBubbleId, 'Stream interrupted - tool call incomplete', true);
          
          vscode.postMessage({
            type: 'toolResultToLLM',
            toolType: 'Unknown',
            success: false,
            error: 'Stream was interrupted before tool call completed',
            summary: 'Tool call incomplete due to stream interruption'
          });
        }

        inThinkingBlock = false;
        regularStreamBuffer = '';
        toolCallBuffer = '';
        activeToolBubbleId = null;  // NEW: Clear active tool bubble ID
        hasReceivedChunk = false;
        
        console.log(`[Dev-Tool] endStream/stoppedStream - clearing state, currentState was: ${currentState}`);
        
        currentState = STREAMING_STATE.IDLE;

        // Reset tool failure tracking on stream end
        window.toolFailureCount = {};

        // End stream but keep the assistant bubble reference
        setStreamingState({ isStreaming: false, assistantElem: state.assistantElem, assistantRaw: '' });
        
        console.log(`[Dev-Tool] endStream/stoppedStream - final state: currentState=${currentState}, isStreaming=false`);
        
        // Button state managed by syncStreamingState message
        
        break;
      }

       case 'appendUser': {
        const { message, chatTokens, fileTokens } = ev.data;
        if (message && typeof chatTokens === 'number') {
          appendBubble(message, 'user-message', chatTokens, fileTokens || 0);
        }
        break;
      }

      case 'fileContextTokens': {
        // Handle new dual token display format
        const data = ev.data;
        updateFileContextTokens({ 
          scopeTokens: data.scopeTokens,
          sentTokens: data.sentTokens 
        }, contextSize);
        break;
      }

      case 'streamTokenUpdate': {
        const state = getStreamingState();
        if (state.assistantElem && typeof ev.data.tokens === 'number') {
          // Skip placeholder bubbles - they don't have token footers
          if (state.assistantElem.classList.contains('placeholder-bubble')) {
            break;
          }
          // Update token count only on assistant/response bubbles, not thinking bubbles
          if (state.assistantElem.classList.contains('thinking-bubble')) {
            break;
          }
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

        case 'toolResultToLLM': {
         const { toolType, success, error, summary, content, ...rest } = ev.data;
         
         console.log(`[Dev-Tool] toolResultToLLM received: type=${toolType}, success=${success}`);
         console.log(`[Dev-Tool] Looking for active tool bubble...`);
         
         // Find and update the active/closing tool bubble
         const activeTool = getActiveToolBubble();
        
        if (!success) {
          console.error(`Tool ${toolType} failed:`, error);
          
          // Update tool bubble with error state
          if (activeTool) {
            closeToolBubble(activeTool.id, error || 'Unknown error', true);
            // Clear the active tool bubble ID after closing
            activeToolBubbleId = null;
          }
          
          // Track retry attempts - check if we've seen this tool fail before
          const recentFailures = window.toolFailureCount = window.toolFailureCount || {};
          const failureKey = `${toolType}-${activeTool?.id || 'unknown'}`;
          recentFailures[failureKey] = (recentFailures[failureKey] || 0) + 1;
          
          if (recentFailures[failureKey] <= MAX_TOOL_RETRIES) {
            // Create retry feedback bubble
            createRetryBubble(toolType, recentFailures[failureKey], MAX_TOOL_RETRIES);
            
            // Send error to LLM for automatic retry
            vscode.postMessage({
              type: 'sendToAI',
              message: `Error in tool ${toolType}: ${error}. Please try a different approach or reformat your tool call.`,
              mode: 'chat'
            });
          } else {
            // Max retries exceeded - inform user explicitly
            createRetryBubble(toolType, MAX_TOOL_RETRIES + 1, MAX_TOOL_RETRIES);
            
            // Send final error message to LLM with instruction to try different approach
            vscode.postMessage({
              type: 'sendToAI',
              message: `Tool ${toolType} has failed ${MAX_TOOL_RETRIES} times. Please try a completely different approach or ask for clarification.`,
              mode: 'chat'
            });
          }
          
          // Hide indicators if present
          hideReadingIndicator();
          hideSearchIndicator();
          break;
        }

        // Success - update tool bubble with summary
        console.log(`[Dev-Tool] Tool succeeded: ${summary || 'no summary'}`);
        if (activeTool) {
          console.log(`[Dev-Tool] Updating active bubble ${activeTool.id} with result`);
          closeToolBubble(activeTool.id, summary || content, false);
          // Clear the active tool bubble ID after closing
          activeToolBubbleId = null;
        } else {
          console.error('[Dev-Tool] ERROR: No active tool bubble found!');
        }

        // Create collapsed assistant bubble showing what was sent to LLM
        appendToolResultBubble(toolType, summary, content);

        // Send the tool result back to the LLM (extension will add continuation prompt)
        console.log(`[Dev-Tool] Sending sendToAI for tool result, message length=${`// Tool result from ${toolType}\n${content}`.length}`);
        vscode.postMessage({
          type: 'sendToAI',
          message: `// Tool result from ${toolType}\n${content}`,
          mode: 'chat',
          language: '',
          isToolResult: true // Flag to avoid creating user bubble but still prompt continuation
        });

        break;
      }

       case 'fileContentResult': {
        // Deprecated - use toolResultToLLM instead  
        const { success, error, uri, startLine, endLine, lines, fullFile } = ev.data;
        
        if (!success) {
          console.error('File content request failed:', error);
          break;
        }

        hideReadingIndicator();
        
        // Fallback for old format - create collapsed bubble
        const modeText = fullFile ? 'Full file' : `offset ${startLine}; limit ${endLine - startLine + 1}`;
        appendToolResultBubble(
          'fileContent',
          `Read file: ${uri.split('/').pop()} - ${modeText}`,
          [
            `// File content from ${uri}`,
            `// ${modeText}:`,
            ...lines.map(l => `${l.lineNumber}: ${l.text}`)
          ].join('\n')
        );
        
        break;
      }

      case 'searchResult': {
        // Deprecated - use toolResultToLLM instead
        const { success, error, query, scope, matches } = ev.data;
        
        if (!success || !matches?.length) {
          console.error('Search failed or no results:', error);
          break;
        }

        hideSearchIndicator();
        
        // Fallback for old format - create collapsed bubble
        appendToolResultBubble(
          'search',
          `Searched for "${query}" in ${scope} scope - found ${matches.length} matches`,
          [
            `// Search results for "${query}" (${scope} scope)`,
            ...matches.map(m => `- ${m.uri}:${m.line} - ${m.text}`)
          ].join('\n')
        );
        
        break;
      }

       case 'showReadingIndicator': {
        const { uri, startLine, lineCount } = ev.data;
        const fileName = uri.split('/').pop() || uri;
        
        // Create a temporary indicator bubble
        const indicator = document.createElement('div');
        indicator.className = 'reading-indicator';
        indicator.id = `reading-${Date.now()}`;
        indicator.innerHTML = `
          <span class="indicator-icon">📖</span>
          <span class="indicator-text">Reading: ${fileName} - offset ${startLine}, range ${lineCount}</span>
        `;
        
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
          chatContainer.appendChild(indicator);
          scrollToBottomImmediate(true);
          
          // Auto-remove after 2 seconds
          setTimeout(() => {
            if (indicator.parentNode) {
              indicator.parentNode.removeChild(indicator);
            }
          }, 2000);
        }
        break;
      }

      case 'showSearchIndicator': {
        const { query, scope } = ev.data;
        
        // Create a temporary indicator bubble
        const indicator = document.createElement('div');
        indicator.className = 'search-indicator';
        indicator.id = `search-${Date.now()}`;
        indicator.innerHTML = `
          <span class="indicator-icon">🔍</span>
          <span class="indicator-text">Searching: "${query}", Scope: ${scope}</span>
        `;
        
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
          chatContainer.appendChild(indicator);
          scrollToBottomImmediate(true);
          
          // Auto-remove after 2 seconds
          setTimeout(() => {
            if (indicator.parentNode) {
              indicator.parentNode.removeChild(indicator);
            }
          }, 2000);
        }
        break;
      }

       case 'sessionTokenUpdate':
         updateTokenPanel({ sessionTokens, fileContextTokens, toolsTokens, totalTokens }, contextSize);
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
        
        // Button state managed by syncStreamingState message
        scrollToBottomImmediate(true);
      }

      case 'invokeCommand':
        // This type is handled by the extension host, not the webview router.
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  });
}
