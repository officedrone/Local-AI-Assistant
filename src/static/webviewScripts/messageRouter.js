// src/static/webviewScripts/messageRouter.js
import { appendBubble, getStreamingState, setStreamingState } from './chat.js';
import { updateContextTokens } from './contextControls.js';
import { updateTokenPanel } from './sessionTokens.js';
import { updateServiceStatus } from './serviceStatus.js';
import {
  scrollToBottomImmediate,
  shouldAutoScroll,
  setAutoScrollEnabled,
  setUserInitiatedScroll
} from './scrollUtils.js';
import { renderMd, injectLinks } from './markdownUtils.js';

// Track thinking state
let inThinkingBlock = false;
let thinkingBuffer = '';

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, tokens, sessionTokens, fileContextTokens, totalTokens } = ev.data;

    switch (type) {
      case 'startStream': {
        const bubble = appendBubble('…', 'ai-message thinking');
        setStreamingState({ isStreaming: true, assistantElem: bubble, assistantRaw: '' });

        setUserInitiatedScroll(false);
        setAutoScrollEnabled(true);

        document.getElementById('sendButton').textContent = 'Stop';
        scrollToBottomImmediate(true);
        break;
      }

      case 'streamChunk': {
        const state = getStreamingState();

        let chunk = message || '';

        // Detect start of <think>
        if (chunk.includes('<think>')) {
          inThinkingBlock = true;
          thinkingBuffer = '';
          chunk = chunk.replace('<think>', '');
          // Mark bubble visually as thinking
          state.assistantElem.classList.add('thinking');
        }

        // Detect end of </think>
          if (chunk.includes('</think>')) {
            inThinkingBlock = false;
            chunk = chunk.replace('</think>', '');
            thinkingBuffer = '';

            // Remove thinking style
            state.assistantElem.classList.remove('thinking');

            // Reset assistantRaw so final answer overwrites thinking text
            setStreamingState({ ...state, assistantRaw: '' });

            // Optionally clear the bubble content entirely
            const body = state.assistantElem.querySelector('.markdown-body');
            body.innerHTML = '<strong>Assistant:</strong><br/>'; // no dots, ready for real content

            return; // skip normal render this tick
          }

        if (inThinkingBlock) {
          thinkingBuffer += chunk;
          const body = state.assistantElem.querySelector('.markdown-body');

          // Separate fixed header from scrollable content
          body.innerHTML = `
            <div class="thinking-header">💡 Thinking…</div>
            <div class="thinking-content">${renderMd(thinkingBuffer)}</div>
          `;

          // Auto-scroll the inner thinking content itself
          const contentEl = body.querySelector('.thinking-content');
          if (contentEl) {
            contentEl.scrollTop = contentEl.scrollHeight;
          }

          if (shouldAutoScroll) scrollToBottomImmediate(true);
          return;
        }



        // Normal streaming after thinking block
        const nextRaw = (state.assistantRaw || '') + chunk;
        setStreamingState({ ...state, assistantRaw: nextRaw });

        const body = state.assistantElem.querySelector('.markdown-body');
        body.innerHTML =
          '<strong>Assistant:</strong><br/>' +
          renderMd(nextRaw);

        injectLinks(state.assistantElem);

        if (shouldAutoScroll) {
          scrollToBottomImmediate(true);
        }
        break;
      }

      case 'appendAssistant':
        if (!getStreamingState().isStreaming && message && typeof tokens === 'number') {
          appendBubble(message, 'ai-message', tokens);
        }
        break;

      case 'endStream':
      case 'stoppedStream':
        const state = getStreamingState();
        if (state.assistantElem) {
          state.assistantElem.classList.remove('thinking'); // remove pulsating style
        }
        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
        inThinkingBlock = false;
        thinkingBuffer = '';
        break;

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
          vscode.postMessage({ type: 'refreshApiStatus' });
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
