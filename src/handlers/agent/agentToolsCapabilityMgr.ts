// src/handlers/agent/agentToolsCapabilityMgr.ts
import * as vscode from 'vscode';
import { WebviewPanel } from 'vscode';

/**
 * Handle a toggleCapability message from the webview.
 * Persists the capability state into VS Code settings.
 *
 * Note: stores capabilities under "localAIAssistant.capabilities".
 * Key names should match what webview and prompts expect (e.g. "allowFileEdits").
 */
export async function handleToggleCapability(
  evt: { key: string; value: boolean },
  panel: WebviewPanel
) {
  if (!evt || typeof evt.key !== 'string') return;
  await vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .update(evt.key, evt.value, vscode.ConfigurationTarget.Global);

  // Re‑send capabilities so webview + LLM know current state
  sendCapabilities(panel);
}

/**
 * Broadcast the current capabilities to the webview.
 */
export function sendCapabilities(panel: WebviewPanel) {
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
