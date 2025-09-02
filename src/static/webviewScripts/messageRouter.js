// /src/static/webviewScripts/messageRouter.js

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

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, tokens, sessionTokens, fileContextTokens, totalTokens } = ev.data;

    switch (type) {
      case 'startStream': {
        const bubble = appendBubble('…', 'ai-message thinking');
        setStreamingState({ isStreaming: true, assistantElem: bubble, assistantRaw: '' });

        // Reset any accidental user-scroll lock and pin to bottom
        setUserInitiatedScroll(false);
        setAutoScrollEnabled(true);

        document.getElementById('sendButton').textContent = 'Stop';
        scrollToBottomImmediate(true);
        break;
      }

      case 'streamChunk': {
        const state = getStreamingState();
        if (state.assistantElem?.classList.contains('thinking')) {
          state.assistantElem.classList.remove('thinking');
        }

        const nextRaw = (state.assistantRaw || '') + (message || '');
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
        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
        document.getElementById('sendButton').textContent = 'Send';
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

          // Only scroll if auto-scroll is still enabled
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
        // For code changes or validations, always scroll to bottom
        scrollToBottomImmediate(true);
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  });
}
