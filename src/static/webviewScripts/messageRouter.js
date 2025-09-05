// src/static/webviewScripts/messageRouter.js
import { appendBubble, getStreamingState, setStreamingState } from './chat.js';
import { updateContextTokens } from './contextControls.js';
import { updateTokenPanel } from './sessionTokens.js';
import { updateServiceStatus } from './serviceStatus.js';
import {
  scrollToBottomImmediate,
  shouldAutoScroll,
  setAutoScrollEnabled,
  setUserInitiatedScroll,
  scheduleScrollToBottom
} from './scrollUtils.js';
import { renderMd, injectLinks } from './markdownUtils.js';

// Track thinking state and chunk receipt
let inThinkingBlock = false;
let thinkingBuffer = '';
let hasReceivedChunk = false;
let noChunkTimer = null;

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, tokens, sessionTokens, fileContextTokens, totalTokens } = ev.data;

    switch (type) {
      case 'startStream': {
        hasReceivedChunk = false;
        const bubble = appendBubble('…', 'ai-message');
        setStreamingState({ isStreaming: true, assistantElem: bubble, assistantRaw: '' });

        // Start with visual pulse only
        bubble.classList.add('pulsing');
        inThinkingBlock = false;
        thinkingBuffer = '';

        // Watchdog: if no chunk arrives soon, show interim message + real thinking mode
        if (noChunkTimer) clearTimeout(noChunkTimer);
        noChunkTimer = setTimeout(() => {
          if (!hasReceivedChunk) {
            const state = getStreamingState();
            if (state.assistantElem) {
              const body = state.assistantElem.querySelector('.markdown-body');
              body.innerHTML = `<strong>Assistant:</strong><i><br/>
                <span class="status-reason">&lt; LLM is taking longer than expected to reply &gt;</span>`;
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
        const state = getStreamingState();
        state.assistantElem.classList.remove('pulsing');
        let chunk = message || '';

        // Detect start of <think> or <seed:think>
        if (chunk.includes('<think>') || chunk.includes('<seed:think>')) {
          inThinkingBlock = true;
          thinkingBuffer = '';
          chunk = chunk.replace('<think>', '').replace('<seed:think>', '');

          // Switch bubble to thinking mode only now
          state.assistantElem.classList.add('thinking');
        }

        // Detect end of </think> or </seed:think>
        if (chunk.includes('</think>') || chunk.includes('</seed:think>')) {
          inThinkingBlock = false;
          chunk = chunk.replace('</think>', '').replace('</seed:think>', '');
          thinkingBuffer = '';

          // Remove thinking style
          state.assistantElem.classList.remove('thinking');

          // Reset assistantRaw so final answer overwrites thinking text
          setStreamingState({ ...state, assistantRaw: '' });

          // Clear bubble content entirely, ready for real content
          const body = state.assistantElem.querySelector('.markdown-body');
          body.innerHTML = '<strong>Assistant:</strong><br/>';
          // IMPORTANT: do NOT return here — let any remaining chunk fall through
        }

        if (inThinkingBlock) {
          thinkingBuffer += chunk;

          const body = state.assistantElem.querySelector('.markdown-body');
          let contentEl = body.querySelector('.thinking-content');

          // Create the structure once
          if (!contentEl) {
            body.innerHTML = `
              <div class="thinking-header">💡 Thinking…</div>
              <div class="thinking-content"></div>
            `;
            contentEl = body.querySelector('.thinking-content');

            // Track whether user is at bottom
            contentEl.dataset.autoScroll = 'true';
            contentEl.addEventListener('scroll', () => {
              const atBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 20;
              contentEl.dataset.autoScroll = atBottom.toString();
            });
          }

          // Update content without replacing the element
          contentEl.innerHTML = renderMd(thinkingBuffer);

          // Only auto-scroll inner content if user is at bottom
          if (contentEl.dataset.autoScroll === 'true') {
            contentEl.scrollTop = contentEl.scrollHeight;
          }

          // Outer chat scroll still works if user hasn't scrolled up there
          if (shouldAutoScroll) {
            scheduleScrollToBottom();
          }
          return;
        }

        // Normal streaming after thinking block or non-thinking stream
        const nextRaw = (state.assistantRaw || '') + chunk;
        setStreamingState({ ...state, assistantRaw: nextRaw });

        const body = state.assistantElem.querySelector('.markdown-body');
        body.innerHTML = '<strong>Assistant:</strong><br/>' + renderMd(nextRaw);

        injectLinks(state.assistantElem);

        if (shouldAutoScroll) scheduleScrollToBottom();
        break;
      }

      case 'earlyEnd': {
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }

        const state = getStreamingState();

        if (state.assistantElem) {
          const body = state.assistantElem.querySelector('.markdown-body');

          if (!hasReceivedChunk) {
            // No output at all yet — replace placeholder
            body.innerHTML = `<strong>Assistant:</strong><br/>${ev.data.reason}`;
          } else if (inThinkingBlock) {
            const rendered = renderMd(thinkingBuffer || '');
            body.innerHTML = `<strong>Assistant:</strong><br/>${rendered}`;
          }
          // Always clear thinking style if present
          state.assistantElem.classList.remove('thinking');
        }
        // Reset flags/buffer regardless of whether we had an element
        inThinkingBlock = false;
        thinkingBuffer = '';
        hasReceivedChunk = false;

        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
        break;
      }



      case 'appendAssistant':
        if (!getStreamingState().isStreaming && message && typeof tokens === 'number') {
          appendBubble(message, 'ai-message', tokens);
        }
        break;

      case 'endStream':
      case 'stoppedStream': {
        if (noChunkTimer) { clearTimeout(noChunkTimer); noChunkTimer = null; }

        const state = getStreamingState();

        if (state.assistantElem) {
          // If nothing was streamed, replace the placeholder with a clear message
          if (!hasReceivedChunk) {
            const body = state.assistantElem.querySelector('.markdown-body');
            body.innerHTML = `<strong>Assistant:</strong><i><br/>
              <span class="status-reason">&lt; No response received from LLM. Verify the URL, API, and model are correct. &gt;</span>`;
            if (shouldAutoScroll) {
              scrollToBottomImmediate(true);
            }
          }

          // remove pulsating style
          state.assistantElem.classList.remove('thinking');
        }

        inThinkingBlock = false;
        thinkingBuffer = '';
        hasReceivedChunk = false;

        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
        break;
      }


      case 'appendUser':
        if (message && typeof tokens === 'number') {
          appendBubble(message, 'user-message', tokens);
        }
        break;

      case 'fileContextTokens':
        updateContextTokens(tokens, contextSize);
        break;

      case 'finalizeAI': {
        const state = getStreamingState();
        if (state.assistantElem && typeof tokens === 'number') {
          const tdiv = document.createElement('div');
          tdiv.className = 'token-count';
          tdiv.textContent = '🧮 ' + tokens + ' tokens';
          state.assistantElem.querySelector('.markdown-body').appendChild(tdiv);

          if (shouldAutoScroll) {
            scrollToBottomImmediate(true);
          }
        }
        break;
      }

      case 'setModel': {
        const modelSpan = document.getElementById('modelNameBox');
        if (modelSpan) {
          const displayName = ev.data.value?.trim() || 'None';
          modelSpan.textContent = 'Model: ' + displayName;
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
          apiTypeSpan.textContent = 'API: ' + displayName;
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
          urlSpan.textContent = 'URL: ' + displayUrl;
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

      default:
        console.warn('Unknown message type:', type);
    }
  });
}
