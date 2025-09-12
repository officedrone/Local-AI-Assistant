// /src/static/webviewScripts/main.js
import { setupScrollHandling } from './scrollUtils.js';
import { setupChatSend } from './chat.js';
import { setupContextControls } from './contextControls.js';
import { setupLLMControls } from './llmControls.js';
import { setupMessageRouter } from './messageRouter.js';


const vscode = acquireVsCodeApi();

window.addEventListener('DOMContentLoaded', () => {
  console.log('Main.js loaded and DOM ready');
  // Grab contextSize from a data attribute injected by chatPanelView.ts
  const contextSize = Number(document.body.dataset.contextSize) || 4096;

  // Initialise UI behaviour
  setupScrollHandling();
  setupChatSend(vscode);
  setupContextControls(vscode);
  setupLLMControls(vscode);

  // Start listening for messages from the extension
  setupMessageRouter(vscode, contextSize);

  // New session button
  document.getElementById('newSessionButton')?.addEventListener('click', () => {
    // First, tell the webview to stop any active stream
    vscode.postMessage({ type: 'stopStream' });

    // Then, start a new session
    vscode.postMessage({ type: 'newSession' });
  });

  // Settings button
  document.getElementById('settingsButton')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
  });

  // Global click handler for copy/insert links
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
    vscode.postMessage({ type: 'webviewReady' });
  });
});
