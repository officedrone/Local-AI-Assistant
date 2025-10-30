// src/handlers/agent/agentToolsIndex.ts
import * as vscode from 'vscode';
import { EditMessage } from './agentToolsVSFiles';
import { canEditFiles } from './agentToolsCapabilityMgr';

type ToolHandler = (payload: any, panel: vscode.WebviewPanel) => Promise<void>;

const toolHandlers: Record<string, ToolHandler> = {
  editFile: async (_payload, _panel) => {
    // Intentionally empty: we no longer auto-apply here.
    // The actual edit happens only after the user clicks "Approve",
    // which triggers 'confirmEdit' → handleEditMessage in chatPanelMessages.ts.
  },
  // Add other tool handlers here as needed
};

export async function dispatchToolCall(payload: any, panel: vscode.WebviewPanel) {
  try {
    const handler = toolHandlers[payload?.type];
    if (handler) {
      const msg = payload as EditMessage;

      // Send preview for user approval
        panel.webview.postMessage({
          type: 'editPreview',
          uri: msg.uri,
          content: msg.edits.map((e) => e.newText ?? '').join('\n'),
          edits: msg.edits,
          preview: '' // optional; handleRequestPreview will send the full preview when requested
        });

      // Do NOT apply edits here; wait for confirmEdit from the webview
      await handler(msg, panel);
    } else {
      panel.webview.postMessage({
        type: 'toolResult',
        tool: payload?.type ?? 'unknown',
        success: false,
        error: 'Unknown tool'
      });
    }
  } catch (err) {
    panel.webview.postMessage({
      type: 'toolResult',
      tool: payload?.type ?? 'unknown',
      success: false,
      error: String(err)
    });
  }
}
