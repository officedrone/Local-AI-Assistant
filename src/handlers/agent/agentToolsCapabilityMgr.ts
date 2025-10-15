// src/handlers/agent/agentToolsCapabilityMgr.ts
import * as vscode from 'vscode';

/**
 * Handle a toggleCapability message from the webview.
 * Persists the capability state into VS Code settings.
 */
export async function handleToggleCapability(
  evt: { key: string; value: boolean },
  panel: vscode.WebviewPanel
) {
  // Update the setting under localAIAssistant.capabilities
  await vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .update(evt.key, evt.value, vscode.ConfigurationTarget.Global);

  // Re‑send capabilities so webview + LLM know current state
  sendCapabilities(panel);
}

/**
 * Broadcast the current capabilities to the webview.
 */
export function sendCapabilities(panel: vscode.WebviewPanel) {
  const allowFileEdits = vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('allowFileEdits', false);

  panel.webview.postMessage({
    type: 'capabilities',
    allowFileEdits
  });
}

/**
 * Accessor for other handlers (e.g. editFile case).
 */
export function canEditFiles(): boolean {
  return vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('allowFileEdits', false);
}
