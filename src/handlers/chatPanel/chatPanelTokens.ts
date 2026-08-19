// src/handlers/chatPanel/chatPanelTokens.ts
import * as vscode from 'vscode';
import {
  getSessionTokenCount,
  getSpentFileContextTokens,
  getToolsTokenCount,
  getEffectiveFileContextTokens,
  getScopeTokens
} from '../../commands/tokenActions';
import { getMaxContextTokens } from './chatPanelConfig';

export function refreshTokenStats(panel: vscode.WebviewPanel) {
  const sessionTokens = getSessionTokenCount();      // Chat + Think
  const sentFileTokens = getSpentFileContextTokens(); // Files (requestFileContent only)
  const toolsTokens = getToolsTokenCount();           // Tools (searchInFile, etc.)

  // Total includes Chat/Think + Tools + Files
  const totalTokens = sessionTokens + toolsTokens + sentFileTokens;

  panel.webview.postMessage({
    type: 'sessionTokenUpdate',
    sessionTokens,
    fileContextTokens: sentFileTokens,
    toolsTokens,       // NEW: Include tool tokens in update message
    totalTokens
  });
}

export function postFileContextTokens(panel: vscode.WebviewPanel) {
  const contextSize = getMaxContextTokens();
  const scopeTokens = getScopeTokens(); // Total tokens in workspace scope
  const sentTokens = getSpentFileContextTokens(); // Tokens actually sent to LLM

  panel.webview.postMessage({
    type: 'fileContextTokens',
    scopeTokens,
    sentTokens,
    contextSize
  });

  //Refresh the combined session stats
  refreshTokenStats(panel);
}
