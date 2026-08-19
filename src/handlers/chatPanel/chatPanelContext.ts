// src/handlers/chatPanel/chatPanelContext.ts

import * as vscode from 'vscode';
import { getActiveChatPanel } from './chatPanel';
import { postFileContextTokens } from './chatPanelTokens';
import { countTextTokens, addToScopeTokens, getSpentFileContextTokens } from '../../commands/tokenActions';

export interface FileContext {
  uri: vscode.Uri;
  language: string;
  lines: { n: number; text: string }[];
  summary: string;
  tokens: number;
  sendFullFile?: boolean;
}

export interface ScopeFile {
  uri: string;
  language: string;
  tokens: number;
}

interface SessionContextState {
  uris: string[];
  fileModes: Map<string, boolean>;
}
 
let contextFiles: FileContext[] = []; // Deprecated - kept for backward compat
let scopeFiles: Set<string> = new Set(); // All workspace files available to LLM (URIs only)
let scopeFileMetadata = new Map<string, ScopeFile>(); // Cache for scope file metadata
let fetchedFiles: FileContext[] = []; // Files whose content has been sent to LLM via tools
let sessionContextState: SessionContextState | null = null;

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
 * @deprecated Use getScopeFiles() or getFetchedFiles() instead
 */
export function getContextFiles(): FileContext[] {
  return contextFiles;
}

/**
 * Get all scope files with their metadata (URI, language, tokens).
 */
export function getScopeFiles(): ScopeFile[] {
  return Array.from(scopeFiles).map(uri => 
    scopeFileMetadata.get(uri) || { uri, language: 'unknown', tokens: 0 }
  );
}

/**
 * Get only the URIs of scope files (for scopeUris field in prompts).
 */
export function getScopeFileURIs(): string[] {
  return Array.from(scopeFiles);
}

/**
 * Get total token count of all files in workspace scope.
 */
export function getScopeTokenCount(): number {
  return getScopeFiles().reduce((sum, f) => sum + f.tokens, 0);
}

/**
 * Add a file URI to the workspace scope with metadata (makes it available for search/request).
 * Calculates token count by reading the file.
 */
export async function addFileToScope(uri: vscode.Uri): Promise<void> {
  const uriStr = uri.toString();
  
  // Deduplicate - skip if already in scope
  if (scopeFiles.has(uriStr)) return;
  
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const language = doc.languageId;
    const tokens = countTextTokens(doc.getText());
    
    scopeFiles.add(uriStr);
    scopeFileMetadata.set(uriStr, { uri: uriStr, language, tokens });
    addToScopeTokens(tokens);
  } catch (err) {
    console.warn(`Failed to add file to scope ${uriStr}:`, err);
  }
}

/**
 * Add a file to scope with pre-calculated metadata (for performance).
 */
export function addToScopeWithMetadata(uri: string, language: string, tokens: number): void {
  if (!scopeFiles.has(uri)) {
    scopeFiles.add(uri);
    scopeFileMetadata.set(uri, { uri, language, tokens });
    addToScopeTokens(tokens);
  }
}

/**
 * Remove a file URI from the workspace scope.
 */
export function removeFileFromScope(uri: vscode.Uri): void {
  const uriStr = uri.toString();
  if (scopeFiles.has(uriStr)) {
    const metadata = scopeFileMetadata.get(uriStr);
    if (metadata) {
      addToScopeTokens(-metadata.tokens); // Remove from token count
    }
    scopeFiles.delete(uriStr);
    scopeFileMetadata.delete(uriStr);
  }
}

/**
 * Clear all files from workspace scope.
 */
export function clearScopeFiles(): void {
  scopeFiles.clear();
  scopeFileMetadata.clear();
}

/**
 * Add all workspace files to scope by scanning the current workspace folder(s).
 * Calculates token count for each file.
 */
export async function addWorkspaceFilesToScope(excludedPatterns: string[] = []): Promise<number> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return 0;
  }

  let addedCount = 0;
  
  // Build a glob pattern that excludes common non-code directories
  const excludePattern = excludedPatterns.length > 0 
    ? `{${excludedPatterns.join(',')}}`
    : '{node_modules,.git,*.min.js,dist,build,out}';

  for (const folder of workspaceFolders) {
    try {
      const files = await vscode.workspace.findFiles(
        '**/*', // Include all files
        excludePattern,
        1000 // Limit to 1000 files per folder to avoid performance issues
      );

      for (const uri of files) {
        const uriStr = uri.toString();
        if (!scopeFiles.has(uriStr)) {
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const language = doc.languageId;
            const tokens = countTextTokens(doc.getText());
            
            scopeFiles.add(uriStr);
            scopeFileMetadata.set(uriStr, { uri: uriStr, language, tokens });
            addToScopeTokens(tokens);
            addedCount++;
          } catch (err) {
            console.warn(`Failed to read file ${uriStr}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to scan workspace folder ${folder.name}:`, err);
    }
  }

  notifyContextUpdated();
  return addedCount;
}

/**
 * Add a file to the context by URI.
 * @deprecated Use addFileToScope() for scope files or fetchFileContent() for fetched content
 */
export async function addFileToContext(uri: vscode.Uri, forceReload: boolean = false, suppressNotification: boolean = false): Promise<void> {
  // For backward compatibility - redirect to scope
  await addFileToScope(uri);
}

/**
 * Add a file to fetched files (content sent to LLM via tools).
 * Deduplicates - won't add if already fetched.
 */
export function addFetchedFile(file: FileContext): void {
  // Deduplicate - if already fetched, don't add again
  const existing = fetchedFiles.find(f => f.uri.toString() === file.uri.toString());
  if (existing) return;
  
  fetchedFiles.push(file);
}

/**
 * Get all files whose content has been sent to LLM via tools.
 */
export function getFetchedFiles(): FileContext[] {
  return fetchedFiles;
}

/**
 * Clear all fetched files (called on new session).
 */
export function clearFetchedFiles(): void {
  fetchedFiles = [];
}

/**
 * Fetch file content from disk and add to fetched files.
 * @param uri File URI to fetch
 * @param startLine Optional start line for smart slicing (1-based)
 * @param endLine Optional end line for smart slicing (inclusive, 1-based)
 * @returns The fetched FileContext
 */
export async function fetchFileContent(
  uri: vscode.Uri, 
  startLine?: number, 
  endLine?: number
): Promise<FileContext> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  let lines = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
  
  // Apply smart slicing if range specified
  if (startLine !== undefined && endLine !== undefined) {
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length, endLine);
    lines = lines.slice(startIdx, endIdx);
  }
  
  const file: FileContext = {
    uri,
    language: doc.languageId,
    lines,
    summary: `Fetched content from ${uri.toString()}`,
    tokens: countTextTokens(lines.map(l => l.text).join('\n'))
  };
  
  addFetchedFile(file);
  return file;
}

/**
 * Remove a file from the context by URI.
 */
export function removeFileFromContext(uri: vscode.Uri): void {
  contextFiles = contextFiles.filter(f => f.uri.toString() !== uri.toString());
  notifyContextUpdated();
}

/**
 * Save current session state for restoration in new sessions.
 * Saves ONLY scope URIs (not content), not fetched files.
 */
export function saveSessionContextState(): SessionContextState {
  const uris = Array.from(scopeFiles); // Save scope URIs only
  const fileModes = new Map<string, boolean>();
  
  // Note: We could track per-file fetch modes here if needed in future
  sessionContextState = { uris, fileModes };
  return sessionContextState;
}

/**
 * Restore scope files from saved state.
 * Does NOT restore fetched files (they may be stale).
 */
export async function restoreSessionContextState(): Promise<void> {
  if (!sessionContextState) {
    return;
  }
  
  // Clear any existing fetched files first
  clearFetchedFiles();
  
  // Add all scope URIs without triggering notifications during batch operation
  for (const uriStr of sessionContextState.uris) {
    const uri = vscode.Uri.parse(uriStr);
    try {
      await addFileToScope(uri);
    } catch (err) {
      console.warn(`Failed to restore file ${uriStr}:`, err);
    }
  }
  
  // Send single consolidated notification after all files are restored
  notifyContextUpdated();
}

/**
 * Internal notification helper.
 */
function notifyContextUpdated() {
  const panel = getActiveChatPanel();
  if (!panel) return;
  
  // Send scope files for UI display (not fetched content)
  panel.webview.postMessage({
    type: 'contextUpdated',
    files: getScopeFiles().map(f => ({
      uri: f.uri,
      language: f.language,
      tokens: f.tokens,
      sendFullFile: false // Default mode for scope files
    })),
    scopeCount: getScopeFiles().length
  });
  postFileContextTokens(panel);
}

/**
 * Clear all files from context.
 */
export function clearContextFiles(): void {
  contextFiles = [];
  notifyContextUpdated();
}

/**
 * Add all currently opened editor tabs (visible and background) to scope.
 */
export async function addAllOpenEditorsToScope() {
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

  // 4) Add to scope
  for (const uri of filtered) {
    await addFileToScope(uri);
  }

  // 5) Notify UI and token stats once
  notifyContextUpdated();
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
  padding = 50,
  maxTokens?: number
) {
  if (!userMessage || !file.lines.length) return [];

  // Check if user wants to send full file (bypass smart slicing)
  if (file.sendFullFile === true) {
    const allLines = file.lines.map((line, idx) => ({
      n: idx + 1,
      text: line.text
    }));
    
    return [{
      startLine: 1,
      endLine: file.lines.length,
      lines: allLines,
      tokens: Math.ceil(file.lines.reduce((acc, l) => acc + l.text.length / 1.4, 0))
    }];
  }

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
