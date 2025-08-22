// src/commands/tokenActions.ts
import encodingForModel from 'gpt-tokenizer';
import * as vscode from 'vscode';
import { getActiveChatPanel, postSessionTokenUpdate } from '../commands/chatPanel';

const CONFIG_SECTION = 'localAIAssistant';

// --- streaming guard (single source of truth) ---
const streamingActive = new WeakMap<vscode.WebviewPanel, boolean>();

export function setStreamingActive(panel: vscode.WebviewPanel, active: boolean) {
  streamingActive.set(panel, active);
}

export function isStreamingActive(panel: vscode.WebviewPanel): boolean {
  return streamingActive.get(panel) === true;
}

// Count tokens in a list of messages (includes metadata padding)
export function countMessageTokens(messages: { role: string; content: string }[]): number {
  let total = 0;
  for (const m of messages) {
    total += encodingForModel.encode(m.content).length;
    total += 4; // metadata padding per message
  }
  return total;
}

// Count tokens in a plain text string
export function countTextTokens(text: string): number {
  return encodingForModel.encode(text).length;
}

// Always count tokens in the currently active file, regardless of checkbox
export function getFileContextTokens(): number {
  const editor = vscode.window.visibleTextEditors.find(
    ed => ed.document.uri.scheme !== 'vscode-webview'
  );
  if (!editor) return 0;
  return countTextTokens(editor.document.getText());
}

// Count tokens in the active file only if context is enabled
export function getEffectiveFileContextTokens(): number {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('context.includeFileContext', true);
  return includeCtx ? getFileContextTokens() : 0;
}

// Get the chat-only token count (excluding file context)
export function getChatTokenCount(): number {
  return sessionTokenCount;
}

// Session token tracking
let sessionTokenCount = 0;

// Add tokens to the session total and update UI (guarded)
export function addToSessionTokenCount(tokens: number): void {
  const panel = getActiveChatPanel();

  // If we know the panel and streaming is not active, ignore late chunks
  if (panel && !isStreamingActive(panel)) return;

  sessionTokenCount += tokens;

  if (panel) {
    postSessionTokenUpdate(
      panel,
      getSessionTokenCount(),
      getEffectiveFileContextTokens()
    );
  }
}

// Reset the session token count
export function resetSessionTokenCount(): void {
  sessionTokenCount = 0;
}

// Get the current session token count
export function getSessionTokenCount(): number {
  return sessionTokenCount;
}
