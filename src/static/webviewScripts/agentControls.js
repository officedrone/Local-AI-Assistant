// src/static/webviewScripts/agentControls.js

let initialized = false;

/**
 * Sets up the "Allow AI to edit files" toggle in the chat panel.
 * @param {any} vscode - The VS Code API object passed from main.js
 */
export function setupAgentControls(vscode) {
  if (initialized) return; // prevent duplicate listeners
  initialized = true;

  const fileEditsToggle = document.getElementById('allowFileEditsToggle');
  const requestFileContentToggle = document.getElementById('requestFileContentToggle');
  const searchInFileToggle = document.getElementById('searchInFileToggle');

  // When user clicks the edit files checkbox, notify extension
  if (fileEditsToggle) {
    fileEditsToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleCapability',
        key: 'allowFileEdits',
        value: fileEditsToggle.checked
      });
    });
  }

  // When user clicks the request file content checkbox, notify extension
  if (requestFileContentToggle) {
    requestFileContentToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleCapability',
        key: 'requestFileContent',
        value: requestFileContentToggle.checked
      });
    });
  }

  // When user clicks the search in file checkbox, notify extension
  if (searchInFileToggle) {
    searchInFileToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleCapability',
        key: 'searchInFile',
        value: searchInFileToggle.checked
      });
    });
  }

  // Listen for capability updates from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'capabilities') {
      if (typeof msg.allowFileEdits === 'boolean' && fileEditsToggle) {
        fileEditsToggle.checked = msg.allowFileEdits;
      }
      if (typeof msg.requestFileContent === 'boolean' && requestFileContentToggle) {
        requestFileContentToggle.checked = msg.requestFileContent;
      }
      if (typeof msg.searchInFile === 'boolean' && searchInFileToggle) {
        searchInFileToggle.checked = msg.searchInFile;
      }
    }
  });

  // Ask extension for current capabilities on startup
  vscode.postMessage({ type: 'refreshCapabilities' });
}
