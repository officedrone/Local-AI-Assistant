// src/commands/tokenActions.ts
import encodingForModel from 'gpt-tokenizer';
import * as vscode from 'vscode';
import { getActiveChatPanel } from '../handlers/chatPanel/chatPanel';
import { refreshTokenStats } from '../handlers/chatPanel/chatPanelTokens';
import { getFetchedFiles } from '../handlers/chatPanel/chatPanelContext';
import { formatFileContexts } from '../static/prompts';

const CONFIG_SECTION = 'localAIAssistant';

// --- streaming & per-turn guards ---
const streamingActive = new WeakMap<vscode.WebviewPanel, boolean>();
const turnFileTokensCounted = new WeakMap<vscode.WebviewPanel, boolean>();

export function setStreamingActive(panel: vscode.WebviewPanel, active: boolean) {
  console.log(`[setStreamingActive] Setting to ${active}`);
  streamingActive.set(panel, active);
  
  // Notify webview to sync button state
  panel.webview.postMessage({ 
    type: 'syncStreamingState', 
    active 
  });
  
  if (!active) {
    // Reset per-turn guard when streaming ends
    turnFileTokensCounted.set(panel, false);
  }
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

// --- File context token helpers ---

/** Count tokens in all files currently fetched/sent to LLM via requestFileContent. */
export function getFileContextTokens(): number {
  return getFetchedFiles()
    .reduce((sum, f) => sum + f.tokens, 0);
}

/** Count tokens in all files currently in context, only if context is enabled. */
export function getEffectiveFileContextTokens(): number {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('context.includeFileContext', true);
  return includeCtx ? getFileContextTokens() : 0;
}

// --- Scope file token tracking ---
let scopeTokenCount = 0; // Cumulative tokens of all files in workspace scope

/** Total tokens of all files currently in workspace scope. */
export function getScopeTokens(): number {
  return scopeTokenCount;
}

/** Add tokens when files are added to scope (can be negative for removal). */
export function addToScopeTokens(amount: number): void {
  scopeTokenCount += amount;
}

/** Clear scope tokens (for debugging/testing). */
export function clearScopeTokens(): void {
  scopeTokenCount = 0;
}

// --- Session (chat-only) token tracking ---
let sessionTokenCount = 0;           // Chat + Think tokens
let spentFileContextTokens = 0;      // Tokens sent via requestFileContent (Files counter)
let toolsTokenCount = 0;             // Tool call tokens (searchInFile, etc.)

/** Chat-only token count (excluding file context). */
export function getChatTokenCount(): number {
  return sessionTokenCount;
}

export function getSessionTokenCount(): number {
  return sessionTokenCount;
}

/** Get cumulative tokens sent to LLM via tool-fetched content. */
export function getSpentFileContextTokens(): number {
  return spentFileContextTokens;
}

/** Get tool call token count (searchInFile, etc.). */
export function getToolsTokenCount(): number {
  return toolsTokenCount;
}

/**
 * Mark file-context tokens as "spent" for the current turn.
 * Adds the effective file-context tokens ONCE per turn, guarded during streaming.
 */
export function markFileTokensSpentForTurn(): void {
  const panel = getActiveChatPanel();
  if (!panel) return;

  if (turnFileTokensCounted.get(panel) === true) return;

  const effective = getEffectiveFileContextTokens();
  spentFileContextTokens += effective;
  turnFileTokensCounted.set(panel, true);

  refreshTokenStats(panel);
}


//Increment spent by a specific amount (e.g., only newly-added files)
export function markFileTokensSpent(amount: number): void {
  const panel = getActiveChatPanel();
  if (!panel) return;

  if (amount > 0) {
    spentFileContextTokens += amount;  // For Files session token counter and Context "Tokens sent to LLM"
    refreshTokenStats(panel);
  }
}

/**
 * Add tool call tokens (e.g., searchInFile results) to the Tools counter.
 * These tokens are tracked separately from Chat/Think and Files.
 */
export function addToolTokens(amount: number): void {
  const panel = getActiveChatPanel();
  if (!panel) return;
  
  toolsTokenCount += amount;
  refreshTokenStats(panel);
}

/**
 * Add tokens from chat messages (user + assistant) to the session total and refresh UI.
 * Do NOT include file-context tokens here — they are computed live and "spent" separately.
 */
export function addChatTokens(chatTokens: number): void {
  const panel = getActiveChatPanel();
  if (!panel) return;

  sessionTokenCount += chatTokens;
  refreshTokenStats(panel);
}

/** Reset chat-only and sent counters at the start of a new session. 
 * Scope tokens persist across sessions - only reset sent tokens. */
export function resetSessionTokenCount(): void {
  sessionTokenCount = 0;
  spentFileContextTokens = 0; // Sent file tokens reset on new session
  toolsTokenCount = 0;        // Tools tokens reset on new session

  const panel = getActiveChatPanel();
  if (panel) {
    turnFileTokensCounted.set(panel, false);
    refreshTokenStats(panel);
  }
}
