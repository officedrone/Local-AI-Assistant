// src/handlers/chatPanel/chatPanelTokens.ts
import * as vscode from 'vscode';
import { getSessionTokenCount, getSpentFileContextTokens, getEffectiveFileContextTokens } from '../../commands/tokenActions';
import { getMaxContextTokens } from './chatPanelConfig';

export function refreshTokenStats(panel: vscode.WebviewPanel) {
  postSessionTokenUpdate(panel, getSessionTokenCount(), getSpentFileContextTokens());
}

export function postSessionTokenUpdate(
  panel: vscode.WebviewPanel,
  sessionTokens: number,
  fileContextTokens: number
) {
  panel.webview.postMessage({
    type: 'sessionTokenUpdate',
    sessionTokens,
    fileContextTokens,
    totalTokens: sessionTokens + fileContextTokens
  });
}

export function postFileContextTokens(panel: vscode.WebviewPanel) {
  const effectiveTokens = getEffectiveFileContextTokens();
  const contextSize = getMaxContextTokens();
  panel.webview.postMessage({ type: 'fileContextTokens', tokens: effectiveTokens, contextSize });
  refreshTokenStats(panel);
}
