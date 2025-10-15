// src/handlers/agent/agentToolsIndex.ts
import * as vscode from 'vscode';
import { handleEditMessage } from './agentToolsVSFiles';
import { canEditFiles } from './agentToolsCapabilityMgr';

const toolHandlers: Record<string, (payload: any, panel: vscode.WebviewPanel) => Promise<void>> = {
  editFile: async (payload, panel) => {
    if (canEditFiles()) {
      await handleEditMessage(payload, panel.webview);
    } else {
      vscode.window.showWarningMessage('File editing by the AI is disabled.');
      panel.webview.postMessage({
        type: 'toolResult',
        tool: 'editFile',
        success: false,
        error: 'File editing capability is disabled',
        data: { uri: payload.uri }
      });
    }
  },
  // searchWeb: async (payload, panel) => { … return toolResult … }
};

export async function dispatchToolCall(payload: any, panel: vscode.WebviewPanel) {
  const handler = toolHandlers[payload.type];
  if (handler) {
    await handler(payload, panel);
  } else {
    panel.webview.postMessage({
      type: 'toolResult',
      tool: payload.type,
      success: false,
      error: 'Unknown tool'
    });
  }
}
