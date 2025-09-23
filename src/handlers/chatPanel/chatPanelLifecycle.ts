// src/handlers/chatPanel/chatPanelLifecycle.ts

import * as vscode from 'vscode';
import { getWebviewContent } from '../../static/chatPanelView';
import { sendInitialSettings, updateApiStatus, watchConfigChanges } from './chatPanelConfig';
import { postFileContextTokens, refreshTokenStats } from './chatPanelTokens';
import { attachMessageHandlers } from './chatPanelMessages';
import { getContextFiles } from './chatPanelContext';

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
let extensionContext: vscode.ExtensionContext;

export function getActiveChatPanel(): vscode.WebviewPanel | undefined {
  return chatPanel;
}

export function registerChatPanelCommand(context: vscode.ExtensionContext) {
  extensionContext = context;

  // Watch config changes
  watchConfigChanges(() => chatPanel, updateApiStatus);

  // When a text document changes, mark context dirty & push new token counts
  vscode.workspace.onDidChangeTextDocument(() => {
    if (chatPanel) {
      postFileContextTokens(chatPanel);
    }
  });

  // When the user switches editors, recalc & push tokens
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (chatPanel && editor && editor.document.uri.scheme !== 'vscode-webview') {
        postFileContextTokens(chatPanel);
      }
    })
  );

  // Register the "Open Chat" command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.openChatPanel', () => {
      if (chatPanel) {
        chatPanel.reveal(vscode.ViewColumn.Two);
        postFileContextTokens(chatPanel);
      } else {
        getOrCreateChatPanel();
      }
    })
  );
}

export function getOrCreateChatPanel(): vscode.WebviewPanel {
  if (chatPanel) {
    chatPanel.reveal(vscode.ViewColumn.Two);
    postFileContextTokens(chatPanel);
    updateApiStatus(chatPanel);
    refreshTokenStats(chatPanel);
    return chatPanel;
  }

  // Split the editor in a 2:1 ratio
  vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{ size: 2 }, { size: 1 }]
  });

  chatPanel = vscode.window.createWebviewPanel(
    'LocalAIAssistantChat',
    'Local AI Assistant Chat',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  chatPanel.onDidDispose(() => {
    chatPanel = undefined;
  });

  chatPanel.webview.html = getWebviewContent(extensionContext, chatPanel);

  sendInitialSettings(chatPanel);
  updateApiStatus(chatPanel);
  postFileContextTokens(chatPanel);

  attachMessageHandlers(chatPanel, () => chatPanel = undefined);

  return chatPanel;
}
