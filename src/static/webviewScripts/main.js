// /src/static/webviewScripts/main.js
import { setupScrollHandling } from './scrollUtils.js';
import { setupChatSend } from './chat.js';
import { setupContextControls, updateContextFileList } from './contextControls.js';
import { updateTokenPanel, updateFileContextTokens, updateIncludeCtxStatus } from './sessionTokens.js';
import { setupLLMControls } from './llmControls.js';
import { setupMessageRouter } from './messageRouter.js';
import { setupAgentControls } from './agentControls.js';

const vscode = acquireVsCodeApi();

// Execute when DOM is fully loaded to initialize all components
window.addEventListener('DOMContentLoaded', () => {
  console.log('Main.js loaded and DOM ready');
  const contextSize = Number(document.body.dataset.contextSize) || 4096;

  setupScrollHandling();
  setupChatSend(vscode);
  setupContextControls(vscode);
  setupLLMControls(vscode);
  setupAgentControls(vscode);

  setupMessageRouter(vscode, contextSize);

  vscode.postMessage({ type: 'webviewReady' });

  // Handle clicks on the "New Session" button to start a new chat session
  document.getElementById('newSessionButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopStream' });
    vscode.postMessage({ type: 'newSession' });
  });

  // Close context files dropdown when clicking outside of it
  document.addEventListener('click', (e) => {
    const details = document.querySelector('details.context-files-dropdown');
    if (details?.open && !details.contains(e.target)) {
      details.open = false;
    }
  });

  // Open settings panel when settings button is clicked
  document.getElementById('settingsButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

// Handle click events on code links (copy and insert functionality)
document.body.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLAnchorElement)) return;
  const code = t.dataset.code || '';
    if (t.classList.contains('copy-link')) {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      t.textContent = 'Copied!';
      setTimeout(() => { t.textContent = 'Copy'; }, 2000);
    } else if (t.classList.contains('insert-link')) {
      vscode.postMessage({ type: 'insertCode', message: code });
    }
  });
});

// Handle messages received from VS Code extension
window.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.contextSize != null) {
    document.body.dataset.contextSize = String(msg.contextSize);
  }

  // Update session token panel display with new token information
  if (msg.type === 'sessionTokenUpdate') {
    const contextSize = Number(document.body.dataset.contextSize || '4096');
    updateTokenPanel(msg, contextSize);
  }

  // Update file context tokens information
  if (msg.type === 'fileContextTokens') {
    updateFileContextTokens(msg.tokens, msg.contextSize);
  }

  // Update context file list and include status when context changes
  if (msg.type === 'contextUpdated') {
    const files = Array.isArray(msg.files) ? msg.files : [];
    updateIncludeCtxStatus(files.length > 0);
    updateContextFileList(vscode, files);
  }

  // Log tool execution results (success or failure)
  if (msg.type === 'toolResult') {
    const { tool, success, data, error } = msg;
    if (success) {
      console.log(`✅ Tool ${tool} succeeded`, data);
    } else {
      console.error(`❌ Tool ${tool} failed:`, error);
    }
  }
});


export function activate(vscode) {
  setupAgentControls(vscode);
}

// Handle Alt+Enter keyboard shortcut for inserting newlines in message input
document.getElementById('messageInput').addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();

    const textarea = e.target;
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
  }
});
