// src/static/chatPanelView.ts
import * as vscode from 'vscode';
import { getSessionTokenCount, getSpentFileContextTokens } from '../commands/tokenActions';

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
      </div>
    </div>

    <div class="llm-info-row">
      <span id="llmURLBox" title="Click to set LLM URL">URL: ${displayUrl}</span>
      <span id="apiTypeBox" title="Select API Type">API: ${apiType}</span>
      <span id="modelNameBox" title="Click to change model">Model: ${modelName}</span>
      <button id="refreshSvcBtn" class="refreshSvcBtn" title="Refresh URL / API / Model Status">⟳</button>
    </div>

    <div id="sessionTokenContainer">
      <div class="tokenTitle">Session Token Usage</div>
      <div class="tokenRow">
        <div class="tokenItem">
          Chat: <span id="sessionTokenCount">${getSessionTokenCount()}</span>
        </div>
        <div class="tokenItem">
          Files: <span id="fileTokenCount">${getSpentFileContextTokens()}</span>
        </div>
        <div class="tokenItem">
          Total:
          <span id="totalTokenCount">
            ${getSessionTokenCount() + getSpentFileContextTokens()}
          </span>
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
  <div id="contextControls">
    <div class="context-buttons">
      <button id="addCurrentBtn" title="Add the active editor">📄 Add Current</button>
      <button id="addFileBtn" title="Add a file from disk">➕ Add File</button>
      <button id="addEditorsBtn" title="Add all opened editors">📂 Add Editors</button>
      <button id="clearContextBtn" title="Clear context files">🗑️ Clear</button>
    </div>
    <div id="contextFileList" class="context-file-list">
      <em>No files in context</em>
    </div>
  </div>

  <script src="${mdItUri}"></script>
  <script type="module" src="${mainJsUri}"></script>
</body>
</html>`;
}
