// src/handlers/chatPanel/chatPanelContext.ts

import * as vscode from 'vscode';
import { getActiveChatPanel } from './chatPanel';
import { postFileContextTokens } from './chatPanelTokens';
import { countTextTokens } from '../../commands/tokenActions';

export interface FileContext {
  uri: vscode.Uri;
  language: string;
  lines: { n: number; text: string }[];
  summary: string;
  tokens: number;
}
 
let contextFiles: FileContext[] = [];

/**
 * Return the "primary" code editor (active or first visible non-webview).
 */
export function getCodeEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.scheme !== 'vscode-webview') {
    return active;
  }
  return vscode.window.visibleTextEditors.find(
    (ed) => ed.document.uri.scheme !== 'vscode-webview'
  );
}

/**
 * Get the current list of files in context.
 */
export function getContextFiles(): FileContext[] {
  return contextFiles;
}

/**
 * Add a file to the context by URI.
 */
export async function addFileToContext(uri: vscode.Uri, forceReload: boolean = false): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);

  // Only check for duplicates if not forcing reload
  if (!forceReload && contextFiles.find(f => f.uri.toString() === uri.toString())) {
    return;
  }

  // Remove existing file if forceReload is true (to ensure fresh content)
  if (forceReload) {
    contextFiles = contextFiles.filter(f => f.uri.toString() !== uri.toString());
  }
  const text = doc.getText();
  const lines = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));

  contextFiles.push({
    uri,
    language: doc.languageId,
    lines,
    summary: await generateFileSummary(text, doc.languageId),
    tokens: countTextTokens(text)
  });
  notifyContextUpdated();
}

/**
 * Remove a file from the context by URI.
 */
export function removeFileFromContext(uri: vscode.Uri): void {
  contextFiles = contextFiles.filter(f => f.uri.toString() !== uri.toString());
  notifyContextUpdated();
}

/**
 * Clear all files from context.
 */
export function clearContextFiles(): void {
  contextFiles = [];
  notifyContextUpdated();
}

/**
 * Add all currently opened editor tabs (visible and background) to context.
 * Supports forceReload to ensure fresh content is always loaded.
 */
export async function addAllOpenEditorsToContext(forceReload: boolean = false) {
  // 1) Collect all tabs across all groups
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);

  // 2) Extract URIs
  const uris: vscode.Uri[] = [];
  for (const tab of tabs) {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) {
      uris.push(input.uri);
    } else if (input instanceof vscode.TabInputTextDiff) {
      uris.push(input.modified);
    }
  }

  // 3) Filter and dedupe
  const seen = new Set<string>();
  const filtered = uris.filter(uri => {
    const key = uri.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return uri.scheme !== 'vscode-webview' &&
           uri.scheme !== 'output' &&
           uri.scheme !== 'vscode';
  });

  // 4) Add to context array (delegating to addFileToContext with forceReload)
  for (const uri of filtered) {
    await addFileToContext(uri, forceReload);
  }

  // 5) Notify UI and token stats once
  notifyContextUpdated();
}

function notifyContextUpdated() {
  const panel = getActiveChatPanel();
  if (panel) {
    panel.webview.postMessage({
      type: 'contextUpdated',
      files: getContextFiles().map(f => ({
        uri: f.uri.toString(),
        language: f.language,
        tokens: f.tokens
      }))
    });
    postFileContextTokens(panel);
  }
}

//Summary generator
async function generateFileSummary(text: string, language: string): Promise<string> {
  const firstLines = text.split(/\r?\n/).slice(0, 20).join("\n");
  return `Summary of ${language} file:\n${firstLines}`;
}

//Slice Extractor
export function extractRelevantSlices(
  file: FileContext,
  userMessage: string,
  padding = 30,
  maxTokens = 4000
) {
  if (!userMessage || !file.lines.length) return [];

  // 1. Extract meaningful keywords
  const keywords = userMessage
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && w.length < 50);

  if (keywords.length === 0) return [];

  // 2. Find hit lines (0-based internally)
  const hits = file.lines
    .map((line, index) => ({ lineIndex: index, text: line.text }))
    .filter(({ text }) => {
      const lowerText = text.toLowerCase();
      return keywords.some(k => lowerText.includes(k));
    });

  if (hits.length === 0) return [];

  // 3. Cluster nearby hits
  const clusters: number[][] = [];
  let currentCluster = [hits[0].lineIndex];

  for (let i = 1; i < hits.length; i++) {
    const currentLine = hits[i].lineIndex;
    const lastInCluster = currentCluster[currentCluster.length - 1];

    // Merge if within 2x padding distance
    if (currentLine - lastInCluster <= padding * 2) {
      currentCluster.push(currentLine);
    } else {
      clusters.push(currentCluster);
      currentCluster = [currentLine];
    }
  }
  clusters.push(currentCluster);

  // 4. Expand clusters and build slices with proper indexing
  const resultSlices: {
    startLine: number;  // 1-based for LLM
    endLine: number;    // 1-based for LLM
    lines: { n: number; text: string }[];
    tokens: number;
  }[] = [];

  let accumulatedTokens = 0;

  for (const cluster of clusters) {
    const minLine = Math.max(0, cluster[0] - padding);
    const maxLine = Math.min(file.lines.length - 1, cluster[cluster.length - 1] + padding);

    const sliceLines = file.lines.slice(minLine, maxLine + 1);

    // More accurate token estimation (chars / 1.4 for code)
    const sliceTokens = sliceLines.reduce((acc, line) => acc + line.text.length / 1.4, 0);

    if (maxTokens && accumulatedTokens + sliceTokens > maxTokens) {
      break;
    }

    resultSlices.push({
      startLine: minLine + 1,  // Convert to 1-based
      endLine: maxLine + 1,    // Convert to 1-based
      lines: sliceLines.map((line, idx) => ({
        n: minLine + idx + 1,  // Correct 1-based line number
        text: line.text
      })),
      tokens: Math.ceil(sliceTokens)
    });

    accumulatedTokens += sliceTokens;
  }

  return resultSlices;
}
