// /src/static/webviewScripts/main.js
import { setupScrollHandling } from './scrollUtils.js';
import { setupChatSend } from './chat.js';
import { setupContextControls, updateContextFileList } from './contextControls.js';
import { updateTokenPanel, updateFileContextTokens, updateIncludeCtxStatus } from './sessionTokens.js';
import { setupLLMControls } from './llmControls.js';
import { setupMessageRouter } from './messageRouter.js';
import { setupAgentControls } from './agentControls.js';

const vscode = acquireVsCodeApi();

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

  document.getElementById('newSessionButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopStream' });
    vscode.postMessage({ type: 'newSession' });
  });

  document.addEventListener('click', (e) => {
    const details = document.querySelector('details.context-files-dropdown');
    if (!details) return;
    if (details.open && !details.contains(e.target)) {
      details.open = false;
    }
  });

  document.getElementById('settingsButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

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
    // Do not re-send webviewReady on every click; removed to avoid duplicate auto-adds/races
  });
});

window.addEventListener('message', (event) => {
  const msg = event.data;

  // If the extension provided a contextSize, keep the dataset in sync
  if (msg.contextSize != null) {
    document.body.dataset.contextSize = String(msg.contextSize);
  }

  if (msg.type === 'sessionTokenUpdate') {
    const contextSize = Number(document.body.dataset.contextSize || '4096');
    updateTokenPanel(msg, contextSize);
  }

  if (msg.type === 'fileContextTokens') {
    updateFileContextTokens(msg.tokens, msg.contextSize);
  }

  if (msg.type === 'contextUpdated') {
    const files = Array.isArray(msg.files) ? msg.files : [];
    updateIncludeCtxStatus(files.length > 0);
    updateContextFileList(vscode, files); 
  }

  // 🔑 New: handle standardized tool results
  if (msg.type === 'toolResult') {
    const { tool, success, data, error } = msg;
    if (success) {
      console.log(`✅ Tool ${tool} succeeded`, data);
      // TODO: optionally update UI with a success banner or toast
    } else {
      console.error(`❌ Tool ${tool} failed:`, error);
      // TODO: optionally surface error to the user in the panel
    }
  }
});

export function activate(vscode) {
  // existing setup calls
  setupAgentControls(vscode);
}
