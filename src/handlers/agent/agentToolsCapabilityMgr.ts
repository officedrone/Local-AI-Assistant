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
  
  // Map capability keys to setting names
  const settingKey = evt.key === 'editFile' ? 'allowFileEdits' : 
                     evt.key === 'requestFileContent' ? 'requestFileContent' : 
                     evt.key === 'searchInFile' ? 'searchInFile' : evt.key;
                     
  await vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .update(settingKey, evt.value, vscode.ConfigurationTarget.Global);

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

  const requestFileContentEnabled = vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('requestFileContent', true);
    
  const searchInFileEnabled = vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('searchInFile', true);

  panel.webview.postMessage({
    type: 'capabilities',
    allowFileEdits,
    requestFileContent: requestFileContentEnabled,
    searchInFile: searchInFileEnabled
  });
  
  // Also update extension-side state for prompt building
}

/**
 * Accessor for other handlers (e.g. editFile case).
 */
export function canEditFiles(): boolean {
  return vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('allowFileEdits', false);
}

/**
 * Check if file content requests are enabled
 */
export function canRequestFileContent(): boolean {
  const requestFileContentEnabled = vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('requestFileContent', true);
  
  return requestFileContentEnabled;
}

/**
 * Check if file search is enabled
 */
export function canSearchInFile(): boolean {
  const searchInFileEnabled = vscode.workspace
    .getConfiguration('localAIAssistant.capabilities')
    .get<boolean>('searchInFile', true);
  
  return searchInFileEnabled;
}
