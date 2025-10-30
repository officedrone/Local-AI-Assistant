// src/static/webviewScripts/agentControls.js

let initialized = false;

/**
 * Sets up the "Allow AI to edit files" toggle in the chat panel.
 * @param {any} vscode - The VS Code API object passed from main.js
 */
export function setupAgentControls(vscode) {
  if (initialized) return; // prevent duplicate listeners
  initialized = true;

  const toggle = document.getElementById('allowFileEditsToggle');
  if (!toggle) return;

  // When user clicks the checkbox, notify extension
  toggle.addEventListener('change', () => {
    vscode.postMessage({
      type: 'toggleCapability',
      key: 'allowFileEdits',
      value: toggle.checked
    });
  });

  // Listen for capability updates from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'capabilities') {
      if (typeof msg.allowFileEdits === 'boolean') {
        toggle.checked = msg.allowFileEdits;
      }
    }
  });

  // Ask extension for current capabilities on startup
  vscode.postMessage({ type: 'refreshCapabilities' });
}
