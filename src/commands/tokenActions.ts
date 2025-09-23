// src/commands/tokenActions.ts
import encodingForModel from 'gpt-tokenizer';
import * as vscode from 'vscode';
import { getActiveChatPanel } from '../handlers/chatPanel/chatPanel';
import { refreshTokenStats } from '../handlers/chatPanel/chatPanelTokens';
import { getContextFiles } from '../handlers/chatPanel/chatPanelContext';

const CONFIG_SECTION = 'localAIAssistant';

// --- streaming & per-turn guards ---
const streamingActive = new WeakMap<vscode.WebviewPanel, boolean>();
const turnFileTokensCounted = new WeakMap<vscode.WebviewPanel, boolean>();

export function setStreamingActive(panel: vscode.WebviewPanel, active: boolean) {
  streamingActive.set(panel, active);
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

/** Count tokens in all files currently in context, regardless of checkbox. */
export function getFileContextTokens(): number {
  return getContextFiles()
    .map(f => countTextTokens(f.content))
    .reduce((a, b) => a + b, 0);
}

/** Count tokens in all files currently in context, only if context is enabled. */
export function getEffectiveFileContextTokens(): number {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('context.includeFileContext', true);
  return includeCtx ? getFileContextTokens() : 0;
}

// --- Session (chat-only) token tracking ---
let sessionTokenCount = 0;
/** Cumulative file-context tokens spent across turns (does not decrease). */
let spentFileContextTokens = 0;

/** Chat-only token count (excluding file context). */
export function getChatTokenCount(): number {
  return sessionTokenCount;
}

export function getSessionTokenCount(): number {
  return sessionTokenCount;
}

export function getSpentFileContextTokens(): number {
  return spentFileContextTokens;
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
export function markFileTokensSpent(amount: number) {
  if (amount > 0) {
    spentFileContextTokens += amount;
  }
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

/** Reset chat-only and spent counters at the start of a new session. */
export function resetSessionTokenCount(): void {
  sessionTokenCount = 0;
  spentFileContextTokens = 0;

  const panel = getActiveChatPanel();
  if (panel) {
    turnFileTokensCounted.set(panel, false);
    refreshTokenStats(panel);
  }
}
