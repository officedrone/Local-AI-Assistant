// src/handlers/chatPanel/chatPanelTokens.ts
import * as vscode from 'vscode';
import {
  getSessionTokenCount,
  getSpentFileContextTokens,
  getEffectiveFileContextTokens
} from '../../commands/tokenActions';
import { getMaxContextTokens } from './chatPanelConfig';

export function refreshTokenStats(panel: vscode.WebviewPanel) {
  const sessionTokens = getSessionTokenCount();
  const spentFileTokens = getSpentFileContextTokens();

  // Session panel should always reflect cumulative spent tokens
  const totalTokens = sessionTokens + spentFileTokens;

  panel.webview.postMessage({
    type: 'sessionTokenUpdate',
    sessionTokens,
    fileContextTokens: spentFileTokens,
    totalTokens
  });
}

export function postFileContextTokens(panel: vscode.WebviewPanel) {
  const contextSize = getMaxContextTokens();
  const effectiveTokens = getEffectiveFileContextTokens();

  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens: effectiveTokens,
    contextSize
  });

  //Refresh the combined session stats
  refreshTokenStats(panel);
}
