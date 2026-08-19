// src/static/chatPanelView.ts
import * as vscode from 'vscode';
import { 
  getSessionTokenCount, 
  getSpentFileContextTokens,
  getToolsTokenCount
} from '../commands/tokenActions';

const CONFIG_SECTION = 'localAIAssistant';

export function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
): string {
  // Read user settings
  const contextSize = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('context.contextSize', 4096);

  const modelName = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('apiLLM.config.model', '')
    ?.trim() || 'None';

  const displayUrl = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('apiLLM.apiURL.endpoint', '')
    ?.trim() || 'None';

  const apiType = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('apiLLM.apiType', 'openai')
    ?.trim() || 'openai';

  // Build URIs to static resources
  const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'static', 'css', 'styles.css')
  );

  const mdItUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'static', 'css', 'markdown-it.min.js')
  );

  const mainJsUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'static', 'webviewScripts', 'main.js')
  );

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>AI Chat</title>
  <link href="${styleUri}" rel="stylesheet"/>
</head>
<body data-context-size="${contextSize}">
  <div id="session-controls">
    <div class="session-header">
      <div class="session-buttons">
        <button id="newSessionButton">📄 New Session</button>
        <button id="settingsButton" title="Settings">⚙️</button>     
      </div>
      <div id="serviceStatusContainer">
        <span class="status-label">LLM Service Status:</span>
        <span id="api-status"></span>
        <button id="refreshSvcBtn" class="refreshSvcBtn" title="Refresh URL / API / Model Status">⟳</button>
      </div>
    </div>

    <div class="llm-info-row">
      <b>URL: </b><span id="llmURLBox" title="Click to set LLM URL">${displayUrl}</span>
      <b>API: </b><span id="apiTypeBox" title="Select API Type">${apiType}</span>
      <b>Model: </b><span id="modelNameBox" title="Click to change model">${modelName}</span>
    </div>

    <div id="sessionTokenContainer">
      <div class="tokenTitle">Session Tokens:</div>
      <div class="tokenRow">
        <div class="tokenItem">
          Chat/Think: <span id="sessionTokenCount">${getSessionTokenCount()}</span>
        </div>
        <div class="tokenItem">
          Tools: <span id="toolsTokenCount">${getToolsTokenCount()}</span>
        </div>
        <div class="tokenItem">
          Files: <span id="fileTokenCount">${getSpentFileContextTokens()}</span>
        </div>
        <div class="tokenItem">
          Total: <span id="totalTokenCount">${getSessionTokenCount() + getToolsTokenCount() + getSpentFileContextTokens()}</span>
          <span id="maxTokenLabel">
            Context size:
            <span id="contextSizeBox" title="Click to edit max tokens">${contextSize}</span>
          </span>
        </div>
      </div>
    </div>
  </div>

  <button id="scrollToBottomButton" title="Scroll to bottom">↓</button>
  <div id="chat-container"></div>

  <div class="input-wrapper">
    <textarea id="messageInput" placeholder="Type your message…" rows="3"></textarea>
    <div class="button-stack">
      <button id="sendButton">Send</button>
    </div>
  </div>

  <!--Multi-file context controls -->
  <details class="context-section-dropdown" open>
    <summary>&nbsp;&nbsp;Context scope:&nbsp;<span id="scopeFileCount">0</span>&nbsp;files&nbsp;(<span id="scopeTokenCount">0</span>&nbsp;tokens)&nbsp;|&nbsp;Sent to LLM:&nbsp;<span id="sentTokenCount">0</span>&nbsp;tokens&nbsp;&nbsp;</summary>
      <div id="contextControls">
        <div class="context-buttons">
          <button id="addCurrentBtn" title="Add the active editor to scope">📄 Add Current</button>
          <button id="addFileBtn" title="Add a file from disk to scope">➕ Add File</button>
          <button id="addEditorsBtn" title="Add all opened editors to scope">📂 Add Editors</button>
          <button id="clearContextBtn" title="Clear scope files">🗑️ Clear</button>
        </div>

        <div id="contextFileList" class="context-file-list">
          <em>No files in scope</em>
        </div>

        <div class="context-mode-row">
          <span class="mode-label">Fetch Mode:</span>
          <button id="masterModeToggle" class="file-mode-cycle-btn master-mode-toggle" title="Click to toggle default fetch mode for requestFileContent: Smart Slice (specific line ranges) or Full File (entire file content)">Smart Slices ↻</button>
        </div>
      </div>
  </details>

  <!-- Agent controls -->
  <details class="capabilities-dropdown">
    <summary>Tools & Capabilities (Experimental)</summary>
    <label>
      <input type="checkbox" id="allowFileEditsToggle" title="Allow LLM to edit files in the workspace via a tool call"/>
      editFiles (Experimental)
    </label>
    <label>
      <input type="checkbox" id="requestFileContentToggle" title="Allow LLM to request specific line ranges from context files"/>
      requestFileContent
    </label>
    <label>
      <input type="checkbox" id="searchInFileToggle" title="Allow LLM to search for content within workspace files"/>
      searchInFile
    </label>

  </details>




  <script src="${mdItUri}"></script>
  <script type="module" src="${mainJsUri}"></script>
</body>
</html>`;
}
