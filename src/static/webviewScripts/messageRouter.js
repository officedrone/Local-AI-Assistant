// src/static/webviewScripts/messageRouter.js
import { appendBubble, getStreamingState, setStreamingState } from './chat.js';
import { updateContextTokens, updateContextFileList } from './contextControls.js';
import { updateTokenPanel, updateFileContextTokens  } from './sessionTokens.js';
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

// Capabilities variables
let inToolCall = false;
let toolBuffer = '';
let scanBuffer = '';

// Initialize a global store for edit data
window.storedEdits = {};

export function setupMessageRouter(vscode, contextSize) {
  window.addEventListener('message', (ev) => {
    const { type, message, sessionTokens, fileContextTokens, totalTokens } = ev.data;

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
                <span class="status-reason">&lt; LLM is taking a bit longer than expected to reply. This is normal if the model is just being loaded, or if processing large context that was just added.) &gt;</span>`;
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

        // Defensive coercion to string
        let chunk = message ?? '';
        if (typeof chunk !== 'string') {
          if (chunk && typeof chunk === 'object' && 'content' in chunk && typeof chunk.content === 'string') {
            chunk = chunk.content;
          } else {
            try { chunk = String(chunk); } catch { chunk = ''; }
          }
        }

        // ---------- Thinking detection ----------
        if (chunk.includes('<think>') || chunk.includes('<seed:think>') || chunk.includes('[THINK]')) {
          inThinkingBlock = true;
          thinkingBuffer = '';
          chunk = chunk.replace('<think>', '').replace('<seed:think>', '').replace('[THINK]', '');
          state.assistantElem.classList.add('thinking');
        }

        if (chunk.includes('</think>') || chunk.includes('</seed:think>') || chunk.includes('[/THINK]')) {
          inThinkingBlock = false;
          chunk = chunk.replace('</think>', '').replace('</seed:think>', '').replace('[/THINK]', '');
          thinkingBuffer = '';
          state.assistantElem.classList.remove('thinking', 'pulsing');
          setStreamingState({ ...state, assistantRaw: '' });
          const body = state.assistantElem.querySelector('.markdown-body');
          if (body) body.innerHTML = '<strong>Assistant:</strong><br/>';
        }

        if (inThinkingBlock) {
          thinkingBuffer += chunk;
          const body = state.assistantElem.querySelector('.markdown-body');
          let contentEl = body.querySelector('.thinking-content');
          if (!contentEl) {
            body.innerHTML = `
              <div class="thinking-header">💡 Thinking…</div>
              <div class="thinking-content"></div>
            `;
            contentEl = body.querySelector('.thinking-content');
            contentEl.dataset.autoScroll = 'true';
            contentEl.addEventListener('scroll', () => {
              const atBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 20;
              contentEl.dataset.autoScroll = atBottom.toString();
            });
          }
          contentEl.innerHTML = renderMd(thinkingBuffer);
          if (contentEl.dataset.autoScroll === 'true') {
            contentEl.scrollTop = contentEl.scrollHeight;
          }
          if (shouldAutoScroll) scheduleScrollToBottom();
          return;
        }

        // ---------- Tool-call detection ----------
        scanBuffer += chunk;
        const openTag = '[LAIToolCall]';
        const closeTag = '[/LAIToolCall]';

        if (!inToolCall) {
          const openIdx = scanBuffer.indexOf(openTag);
          if (openIdx !== -1) {
            inToolCall = true;
            toolBuffer = '';
            scanBuffer = scanBuffer.slice(openIdx + openTag.length);
            const body = state.assistantElem.querySelector('.markdown-body');
            if (body) {
              body.innerHTML = `
                <div class="thinking-header">🔧 Tool call in progress…</div>
                <div class="thinking-content"></div>
              `;
            }
            state.assistantElem.classList.add('thinking');
          }
        }

        if (inToolCall) {
          const combined = toolBuffer + scanBuffer;
          const closeIdx = combined.indexOf(closeTag);
          if (closeIdx !== -1) {
            // Tool call complete
            toolBuffer = combined.slice(0, closeIdx);
            scanBuffer = combined.slice(closeIdx + closeTag.length);
            inToolCall = false;
            state.assistantElem.classList.remove('pulsing');
            const body = state.assistantElem.querySelector('.markdown-body');
            if (body) {
              body.innerHTML = `
                <div class="thinking-header">🔧 Tool call complete</div>
                <details open>
                  <summary>Show JSON payload</summary>
                  <pre>${toolBuffer.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                </details>
              `;
            }

            try {
              const normalized = toolBuffer.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
              const parsedTool = JSON.parse(normalized);

              // Build raw after-text (content)
              const content = Array.isArray(parsedTool.edits)
                ? parsedTool.edits.map(e => (typeof e.newText === 'string' ? e.newText : '')).join('\n')
                : '';

              // Ask the extension to generate the diff preview string
              vscode.postMessage({
                type: 'requestPreview',
                data: {
                  uri: parsedTool.uri,
                  edits: parsedTool.edits || []
                }
              });
            } catch (e) {
              if (body) {
                body.innerHTML += `<pre class="tool-error">Tool parse error: ${String(e)}</pre>`;
              }
            }

            toolBuffer = '';
          } else {
            toolBuffer = combined;
            scanBuffer = '';
            const body = state.assistantElem.querySelector('.markdown-body');
            let contentEl = body && body.querySelector('.thinking-content');
            if (contentEl) {
              contentEl.innerHTML = `<pre>${toolBuffer.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
              if (contentEl.dataset.autoScroll === 'true') {
                contentEl.scrollTop = contentEl.scrollHeight;
              }
              if (shouldAutoScroll) scheduleScrollToBottom();
            }
            return;
          }
        }

        // ---------- Normal streaming ----------
        function hasPotentialTagFragment(buffer, openTag, closeTag) {
          const candidates = [openTag, closeTag];
          for (const tag of candidates) {
            const max = Math.min(buffer.length, tag.length - 1);
            for (let k = 1; k <= max; k++) {
              const suffix = buffer.slice(-k);
              if (tag.startsWith(suffix)) return true;
            }
          }
          return false;
        }

        if (!inToolCall) {
          const hasFullTag = scanBuffer.includes(openTag) || scanBuffer.includes(closeTag);
          const hasPartialTag = hasPotentialTagFragment(scanBuffer, openTag, closeTag);
          if (!hasFullTag && !hasPartialTag) {
            if (scanBuffer) {
              const nextRaw = (state.assistantRaw || '') + scanBuffer;
              setStreamingState({ ...state, assistantRaw: nextRaw });
              const body = state.assistantElem.querySelector('.markdown-body');
              if (body) {
                body.innerHTML = '<strong>Assistant:</strong><br/>' + renderMd(nextRaw);
                injectLinks(state.assistantElem);
              }
              if (shouldAutoScroll) scheduleScrollToBottom();
              scanBuffer = '';
            }
          }
        }

        break;
      }



      case 'editPreview': {
        console.log('WEBVIEW ← editPreview', ev.data);
        const { content, uri, edits, preview } = ev.data;

        // ensure global store exists
        window.storedEdits = window.storedEdits || {};
        window.storedEdits[uri] = typeof edits === 'string' ? JSON.parse(edits) : edits;

        // Avoid duplicate previews for the same file
        const assistantBubbles = document.querySelectorAll('.ai-message');
        const assistantBubble = assistantBubbles.length
          ? assistantBubbles[assistantBubbles.length - 1]
          : document.body;
        if (assistantBubble.querySelector(`.edit-preview[data-uri="${uri}"]`)) {
          break; // already rendered a preview for this uri
        }

        const previewDiv = document.createElement('div');
        previewDiv.className = 'edit-preview';
        previewDiv.dataset.uri = uri;

        const title = document.createElement('strong');
        title.textContent = `Proposed Changes for ${uri}:`;
        previewDiv.appendChild(title);

        // Quick “after” view
        if (content) {
          const afterPre = document.createElement('pre');
          afterPre.className = 'edit-preview-after';
          afterPre.textContent = content;
          previewDiv.appendChild(afterPre);
        }

        // Full before/after diff view (if provided)
        if (preview) {
          const diffPre = document.createElement('pre');
          diffPre.className = 'edit-preview-diff';
          diffPre.textContent = preview;
          previewDiv.appendChild(diffPre);
        }

        const approveBtn = document.createElement('button');
        approveBtn.className = 'approve-edit';
        approveBtn.dataset.uri = uri;
        approveBtn.textContent = 'Approve Edit';
        previewDiv.appendChild(approveBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'reject-edit';
        rejectBtn.dataset.uri = uri;
        rejectBtn.textContent = 'Reject Edit';
        previewDiv.appendChild(rejectBtn);


        // Insert preview above token counter if present
        try {
          const body = assistantBubble.querySelector('.markdown-body') || assistantBubble;
          const tokenDiv = body.querySelector('.token-count');
          if (tokenDiv && tokenDiv.parentNode === body) {
            body.insertBefore(previewDiv, tokenDiv);
          } else if (body.firstChild) {
            // Insert near the top of the body, after the assistant header if present
            // Prefer inserting after a header element if one exists, otherwise prepend
            const header = body.querySelector('.thinking-header');
            if (header && header.parentNode === body && header.nextSibling) {
              body.insertBefore(previewDiv, header.nextSibling);
            } else {
              body.insertBefore(previewDiv, body.firstChild);
            }
          } else {
            body.appendChild(previewDiv);
          }
        } catch (e) {
          console.error('Failed to insert edit preview into assistant bubble body, appending instead', e);
          try { assistantBubble.appendChild(previewDiv); } catch { document.body.appendChild(previewDiv); }
        }


        previewDiv.addEventListener('click', (e) => {
          const t = e.target;

          // Approve button
          if (t && t.classList && t.classList.contains('approve-edit')) {
            const key = t.dataset.uri;
            const payload = window.storedEdits[key];

            // Disable approve and show confirmation state
            t.disabled = true;
            t.textContent = 'Edit Approved';
            t.classList.add('approved');

            // Disable reject if present to lock the choice
            const rejectBtn = previewDiv.querySelector('.reject-edit');
            if (rejectBtn) rejectBtn.disabled = true;

            // Notify extension
            vscode.postMessage({
              type: 'confirmEdit',
              data: { uri: key, edits: payload }
            });

            return;
          }

          // Reject button
          if (t && t.classList && t.classList.contains('reject-edit')) {
            const key = t.dataset.uri;

            // Show rejected state and disable both buttons
            t.disabled = true;
            t.textContent = 'Edit Rejected';
            t.classList.add('rejected');

            const approveBtn = previewDiv.querySelector('.approve-edit');
            if (approveBtn) {
              approveBtn.disabled = true;
              approveBtn.textContent = 'Approve Edit';
            }

            // Notify extension
            vscode.postMessage({
              type: 'rejectEdit',
              data: { uri: key }
            });

            return;
          }
        });

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
            const rendered = renderMd(thinkingBuffer || '');
            body.innerHTML = `<strong>Assistant:</strong><br/>${rendered}`;
          }

          // Clear transient visual states
          state.assistantElem.classList.remove('thinking', 'pulsing');

          // Apply your aborted status class
          state.assistantElem.classList.add('status-aborted');
        }

        // Reset flags/buffer
        inThinkingBlock = false;
        thinkingBuffer = '';
        hasReceivedChunk = false;

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
          state.assistantElem.classList.remove('thinking', 'pulsing');
          // If nothing was streamed, replace the placeholder with a clear message
          if (!hasReceivedChunk) {
            const body = state.assistantElem.querySelector('.markdown-body');
            body.innerHTML = `<strong>Assistant:</strong><i><br/>
              <span class="status-reason">&lt; No response received from LLM. Verify the URL, API, and model are correct. &gt;</span>`;
            if (shouldAutoScroll) {
              scrollToBottomImmediate(true);
            }
          }

          // Remove thinking or pulsing style
          state.assistantElem.classList.remove('thinking');
          state.assistantElem.classList.remove('pulsing');
        }

        inThinkingBlock = false;
        thinkingBuffer = '';
        hasReceivedChunk = false;

        setStreamingState({ isStreaming: false, assistantElem: null, assistantRaw: '' });
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
        updateFileContextTokens(tokens, contextSize);
        break;

      case 'finalizeAI': {
        const state = getStreamingState();
        const { tokens } = ev.data;
        if (state.assistantElem && typeof tokens === 'number') {
          const tdiv = document.createElement('div');
          tdiv.className = 'token-count';
          tdiv.textContent = '🧮 ' + tokens + ' tokens';
          state.assistantElem.querySelector('.markdown-body').appendChild(tdiv);
          if (shouldAutoScroll) scrollToBottomImmediate(true);
        }
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
        if (state.assistantElem) {
          // Remove visual states and any placeholder text
          state.assistantElem.classList.remove('thinking', 'pulsing');

          // If no chunks were received, update the message to reflect user stopping
          if (!hasReceivedChunk) {
            const body = state.assistantElem.querySelector('.markdown-body');
            if (body) {
              body.innerHTML = `<strong>Assistant:</strong><i><br/>
                <span class="status-reason">&lt; Message Aborted by User &gt;</span>`;
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
