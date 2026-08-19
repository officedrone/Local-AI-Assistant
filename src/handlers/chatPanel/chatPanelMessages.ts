// src/handlers/chatPanel/chatPanelMessages.ts
import * as vscode from 'vscode';
import { getConfig, getMaxContextTokens, updateApiStatus } from './chatPanelConfig';
import { postFileContextTokens, refreshTokenStats } from './chatPanelTokens';
import {
  countMessageTokens,
  countTextTokens,
  getFileContextTokens,
  addChatTokens,
  resetSessionTokenCount,
  getEffectiveFileContextTokens,
  markFileTokensSpent,
  addToolTokens,
  setStreamingActive,
  isStreamingActive
} from '../../commands/tokenActions';
import {
  getCodeEditor,
  addFileToScope,
  getScopeFiles,
  getScopeFileURIs,
  getFetchedFiles,
  clearFetchedFiles,
  removeFileFromContext,
  saveSessionContextState,
  restoreSessionContextState,
  addWorkspaceFilesToScope,
  addToScopeWithMetadata,
  removeFileFromScope,
  addFetchedFile as internalAddFetchedFile,
  clearScopeFiles
} from './chatPanelContext';

// Session scope state variable (tracks per-file fetch modes and global mode)
let sessionScopeState: { uris: string[]; fileModes: Map<string, boolean>; globalFetchMode?: boolean } | null = null;

/**
 * sessionScopeState.fileModes maps URI -> sendFullFile flag
 * - true (Full File): LLM will request entire file content via requestFileContent tool
 * - false (Smart Slice): LLM will request specific line ranges via requestFileContent tool  
 * This controls how the LLM fetches files, NOT what gets added to scope.
 * Scope = workspace availability for tools; Fetched = actual content sent to LLM.
 */

// FileContext interface for fetched files
interface FileContext {
  uri: vscode.Uri;
  language: string;
  lines: { n: number; text: string }[];
  summary: string;
  tokens: number;
  sendFullFile?: boolean;
}

//Agent imports
import { handleEditMessage, handleRequestPreview } from '../agent/agentToolsVSFiles';
import { handleToggleCapability, sendCapabilities, canEditFiles, canRequestFileContent, canSearchInFile } from '../agent/agentToolsCapabilityMgr';
import { dispatchToolCall, searchWorkspaceFiles } from '../agent/agentToolsIndex';

import { chatPrompt } from '../../static/prompts';

//Context imports
import { shouldIncludeContext, markContextDirty } from '../contextHandler';

//Lifecycle, Prompt Builder & router imports
import { buildOpenAIMessages, buildOllamaMessages, PromptContext, getLanguage } from '../../commands/promptBuilder';
import { routeChatRequest, stopHealthLoop, startHealthLoop } from '../../api/apiRouter';
import { getOrCreateChatPanel } from './chatPanelLifecycle';

const CONFIG_SECTION = 'localAIAssistant';
export const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();

let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
let lastFileContextTokens = 0;



// Multi-file context vars
let lastContextState: { uri: string; tokens: number }[] = [];

interface ToolFailure {
  toolType: string;
  error: string;
  timestamp: number;
  payload?: any;
}

let consecutiveToolFailures: ToolFailure[] = [];
const MAX_CONSECUTIVE_FAILURES = 3;

export function attachMessageHandlers(panel: vscode.WebviewPanel, onDispose: () => void) {
  panel.webview.onDidReceiveMessage(async (evt) => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    switch (evt.type) {

      // Multi-file scope cases - files added here are URIs only, no content sent
      case 'addFileToScope': {
        if (evt.uri) {
          await addFileToScope(vscode.Uri.parse(evt.uri));
          
          lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));

          // Update UI with scope files
          const filesForUI = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: false
          }));
          
          panel.webview.postMessage({ 
            type: 'contextUpdated', 
            files: filesForUI,
            scopeCount: getScopeFiles().length
          });
          
          postFileContextTokens(panel);
        }
        break;
      }

      case 'addCurrent': {
        // Ensure an editor is focused so activeTextEditor is set
        await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

        const ed = vscode.window.activeTextEditor;
        if (ed) {
          await addFileToScope(ed.document.uri);
          
          lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));

          // Update UI immediately with scope files
          const filesForUI = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: false // Default mode for scope files
          }));
          panel.webview.postMessage({ 
            type: 'contextUpdated', 
            files: filesForUI,
            scopeCount: getScopeFiles().length
          });
          
          postFileContextTokens(panel);
        } else {
          vscode.window.showWarningMessage('No active editor to add.');
        }
        break;
      }

      case 'addEditors': {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        const uris: vscode.Uri[] = [];
        
        for (const tab of tabs) {
          const input = tab.input;
          if (input instanceof vscode.TabInputText) {
            uris.push(input.uri);
          } else if (input instanceof vscode.TabInputTextDiff) {
            uris.push(input.modified);
          }
        }
        
        const seen = new Set<string>();
        for (const uri of uris.filter(u => u.scheme !== 'vscode-webview' && 
                                          u.scheme !== 'output' && 
                                          u.scheme !== 'vscode')) {
          if (!seen.has(uri.toString())) {
            seen.add(uri.toString());
            await addFileToScope(uri);
          }
        }
        
        lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));

          // Update UI immediately with scope files
          const filesForUI = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: false
          }));
          panel.webview.postMessage({ 
            type: 'contextUpdated', 
            files: filesForUI,
            scopeCount: getScopeFiles().length
          });
          
          postFileContextTokens(panel);
        break;
      }


      case 'pickAndAddFile': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Add to Scope' // Changed label for clarity
        });
        
        if (uris) {
          for (const uri of uris) {
            await addFileToScope(uri);
          }
          
          lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));

          // Update UI with scope files
          const filesForUI = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: false
          }));
          
          panel.webview.postMessage({ 
            type: 'contextUpdated', 
            files: filesForUI,
            scopeCount: getScopeFiles().length
          });
          
          postFileContextTokens(panel);
        }
        break;
      }

      case 'removeFileFromContext': {
        if (evt.uri) {
          const uri = vscode.Uri.parse(evt.uri);
          
          // Remove from scope and clear metadata
          removeFileFromScope(uri);
          
          // Clear file mode from session state
          if (sessionScopeState) {
            sessionScopeState.fileModes.delete(uri.toString());
          }
          
          lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));
          
          // Notify UI of updated scope
          const filesForUI = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: sessionScopeState?.fileModes.get(f.uri) ?? false
          }));
          
          panel.webview.postMessage({ 
            type: 'contextUpdated', 
            files: filesForUI,
            scopeCount: getScopeFiles().length
          });
          
          postFileContextTokens(panel);
        }
        break;
      }


      case 'clearContext': {
        clearScopeFiles();
        
        // Clear all file modes from session state
        if (sessionScopeState) {
          sessionScopeState.fileModes.clear();
        }
        
        lastContextState = [];
        
        // Notify UI of cleared scope
        panel.webview.postMessage({ 
          type: 'contextUpdated', 
          files: [],
          scopeCount: 0
        });
        
        postFileContextTokens(panel);
        break;
      }

      case 'toggleFileMode': {
        // Per-file mode toggle - stored for future fetch operations
        if (evt.uri) {
          const uri = vscode.Uri.parse(evt.uri);
          
          // Store mode in session state for later use
          if (!sessionScopeState) {
            sessionScopeState = { uris: [], fileModes: new Map() };
          }
          sessionScopeState.fileModes.set(uri.toString(), evt.sendFullFile ?? false);
            
          lastContextState = getScopeFiles().map(f => ({ 
            uri: f.uri, 
            tokens: f.tokens 
          }));
            
        panel.webview.postMessage({
          type: 'contextUpdated',
          files: getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: evt.sendFullFile ?? false
          })),
          scopeCount: getScopeFiles().length
        });
        
        postFileContextTokens(panel);
        }
        break;
      }

      case 'setAllMode': {
        const newMode = evt.mode === 'full';
        
        // Store the global mode in session state for future fetch operations
        if (!sessionScopeState) {
          sessionScopeState = { uris: [], fileModes: new Map() };
        }
        (sessionScopeState as any).globalFetchMode = newMode;
        
        lastContextState = getScopeFiles().map(f => ({ 
          uri: f.uri, 
          tokens: f.tokens 
        }));
        
        panel.webview.postMessage({
          type: 'contextUpdated',
          files: getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens,
            sendFullFile: newMode
          })),
          scopeCount: getScopeFiles().length
        });
        
        postFileContextTokens(panel);
        
        break;
      }


      case 'sendToAI': {
        stopHealthLoop(); // pause health checks while streaming

        // If this is a tool call (e.g., editFile), parse and dispatch
        if (evt.mode === 'toolCall') {
          try {
            let payload: any;
            try {
              payload = typeof evt.message === 'string' ? JSON.parse(evt.message) : evt.message;
            } catch (parseErr) {
              // Inform webview of parse failure
              panel.webview.postMessage({
                type: 'toolResult',
                tool: 'unknown',
                success: false,
                error: 'Failed to parse tool call JSON',
                details: String(parseErr)
              });
              return;
            }

            // Dispatch to registered tool handlers (e.g., editFile)
            await dispatchToolCall(payload, panel);
            return; // handled by dispatcher
          } catch (dispatchErr) {
            console.error('Tool call processing error:', dispatchErr);
            panel.webview.postMessage({
              type: 'toolResult',
              tool: evt?.type ?? 'unknown',
              success: false,
              error: String(dispatchErr)
            });
            return;
          }
        }

        // Regular sendToAI flow for chat/validation/completion/tool results
        await handleSendToAI(
          panel,
          evt.message,
          evt.mode || 'chat',
          undefined,        // always use extension-side context
          evt.language,
          (evt as any).isToolResult === true
        );
        break;
      }



      case 'stopGeneration': {
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        
        // Clear streaming flag so user can send another message
        setStreamingActive(panel, false);
        
        panel.webview.postMessage({ type: 'earlyEnd', reason: '(Message Aborted by User)' });
        startHealthLoop(panel);
        break;
      }

      case 'openSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:officedrone.local-ai-assistant'
        );
        break;

      case 'newSession': {
        // Stop any active generation
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        
        // Clear streaming flag before creating new session
        setStreamingActive(panel, false);
        
        panel.webview.postMessage({ type: 'earlyEnd', reason: '(Message Aborted by User)' });

        resetSessionTokenCount();
        conversation = [];
        lastFileContextTokens = 0;

        // Clear fetched files (session-specific)
        clearFetchedFiles();

        // Save current session state (scope URIs only)
        const savedState = saveSessionContextState();

        lastContextState = [];

        panel.dispose();
        onDispose();

        const newPanel = getOrCreateChatPanel();

        // Restore scope files only (not fetched content)
        await restoreSessionContextState();

        lastContextState = getScopeFiles().map(f => ({ uri: f.uri, tokens: f.tokens }));

        const files = getScopeFiles().map(f => ({
          uri: f.uri,
          language: f.language,
          tokens: f.tokens,
          sendFullFile: false // Default mode for scope files
        }));
        newPanel.webview.postMessage({ type: 'contextUpdated', files });

        postFileContextTokens(newPanel);
        refreshTokenStats(newPanel);
        updateApiStatus(newPanel);
        break;
      }




      case 'stopStream': {
        // abort the in-flight request
        {
          const controller = abortControllers.get(panel);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
        }

        // Clear streaming flag so user can send another message
        setStreamingActive(panel, false);

        // trigger UI cleanup in the webview (no "no response" placeholder)
        panel.webview.postMessage({ type: 'stopStream' });

        // resume health checks
        startHealthLoop(panel);
        break;
      }

      case 'insertCode': {
        await handleInsertCode(evt.message);
        break;
      }

      case 'invokeCommand': {
        if (evt.command) {
          vscode.commands.executeCommand(evt.command);
        }
        break;
      }

      case 'webviewReady': {
        // Ensure the UI reflects current extension state
        updateApiStatus(panel);

        // Try to focus an editor so vscode.window.activeTextEditor is available.
        // This avoids the cold-start race where the webview grabs focus before we read the active editor.
        try {
          await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        } catch {}

        // Auto-add the active editor file to SCOPE (only if there's an active editor)
        const active = vscode.window.activeTextEditor;
        if (active) {
          await addFileToScope(active.document.uri);

          lastContextState = getScopeFiles().map(f => ({
            uri: f.uri,
            language: f.language,
            tokens: f.tokens
          }));
        }

        // Send scope files to UI
        const files = getScopeFiles().map(f => ({
          uri: f.uri,
          language: f.language,
          tokens: f.tokens,
          sendFullFile: false // Default mode for scope files
        }));
        panel.webview.postMessage({ 
          type: 'contextUpdated', 
          files,
          scopeCount: getScopeFiles().length
        });

        // Re-send token totals and refresh the visible token stats
        postFileContextTokens(panel);
        refreshTokenStats(panel);

        // 🔑 Broadcast current capabilities so UI + LLM know what's allowed
        sendCapabilities(panel);

        break;
      }

      case 'confirmEdit': {
        try {
          const payload = evt.data;
          if (!payload || typeof payload.uri !== 'string' || !Array.isArray(payload.edits)) {
            panel.webview.postMessage({
              type: 'editResult',
              uri: String(payload?.uri ?? ''),
              success: false,
              error: 'Invalid confirmEdit payload'
            });
            break;
          }

          await handleEditMessage({
            type: 'editFile',
            uri: payload.uri,
            edits: payload.edits
          }, panel.webview);
        } catch (err) {
          panel.webview.postMessage({
            type: 'editResult',
            uri: String(evt?.data?.uri ?? ''),
            success: false,
            error: String(err)
          });
        }
        break;
      }

      case 'requestPreview': {
        try {
          const payload = evt.data;
          if (!payload || typeof payload.uri !== 'string' || !Array.isArray(payload.edits)) {
            panel.webview.postMessage({
              type: 'editPreview',
              uri: String(payload?.uri ?? ''),
              content: '',
              edits: [],
              preview: 'Invalid requestPreview payload'
            });
            break;
          }
          await handleRequestPreview(payload.uri, payload.edits, panel.webview);
        } catch (err) {
          panel.webview.postMessage({
            type: 'editPreview',
            uri: String(evt?.data?.uri ?? ''),
            content: '',
            edits: [],
            preview: String(err)
          });
        }
        break;
      }

      case 'requestFileContent': {
        try {
          const uri = evt.uri ? vscode.Uri.parse(evt.uri) : undefined;
          if (!uri || typeof evt.startLine !== 'number' || typeof evt.endLine !== 'number') {
            consecutiveToolFailures.push({
              toolType: 'fileContent',
              error: 'Invalid requestFileContent payload - missing required fields',
              timestamp: Date.now(),
              payload: evt
            });

            panel.webview.postMessage({
              type: 'toolResultToLLM',
              toolType: 'fileContent',
              success: false,
              error: 'Invalid requestFileContent payload'
            });
            break;
          }

          // Show "Reading" bubble indicator
          panel.webview.postMessage({
            type: 'showReadingIndicator',
            uri: uri.toString(),
            startLine: evt.startLine,
            lineCount: evt.endLine - evt.startLine + 1
          });

          // Find file in SCOPE (case-insensitive for Windows compatibility)
          const scopeFile = getScopeFiles().find(f => f.uri.toLowerCase() === uri.toString().toLowerCase());
          
          if (!scopeFile) {
            consecutiveToolFailures.push({
              toolType: 'fileContent',
              error: `File not found in workspace scope: ${uri.toString()}`,
              timestamp: Date.now(),
              payload: evt
            });

            panel.webview.postMessage({
              type: 'toolResultToLLM',
              toolType: 'fileContent',
              success: false,
              error: `File not found in workspace scope: ${uri.toString()}`
            });
            break;
          }

          // Check if already fetched (deduplication)
          const alreadyFetched = getFetchedFiles().find(f => f.uri.toString() === uri.toString());
          
          let linesToSend: { n: number; text: string }[];
          let startLine: number;
          let endLine: number;
          let sendFullFile: boolean = evt.sendFullFile ?? false;
          
          if (alreadyFetched && sendFullFile) {
            // If requesting full file and we have it cached, return the full cached version
            linesToSend = alreadyFetched.lines.map(l => ({ n: l.n, text: l.text }));
            startLine = 1;
            endLine = alreadyFetched.lines.length;
            sendFullFile = true;
          } else if (alreadyFetched && !sendFullFile) {
            // Requesting a slice of an already-fetched file - check if we have those lines cached
            const startIdx = Math.max(0, evt.startLine - 1);
            const endIdx = Math.min(alreadyFetched.lines.length, evt.endLine);
            
            // Check if requested range exceeds what's in cache
            if (evt.endLine > alreadyFetched.lines.length) {
              // We need to load the file from disk and get the full range
              console.log(`[requestFileContent] Cache miss for lines ${evt.startLine}-${evt.endLine}, fetching from disk`);
              
              const doc = await vscode.workspace.openTextDocument(uri);
              const text = doc.getText();
              const allLines = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
              
              const actualStartIdx = Math.max(0, evt.startLine - 1);
              const actualEndIdx = Math.min(allLines.length, evt.endLine);
              
              linesToSend = allLines.slice(actualStartIdx, actualEndIdx);
              startLine = evt.startLine;
              endLine = evt.endLine;
            } else if (startIdx < alreadyFetched.lines.length && startIdx <= endIdx) {
              // We have these lines cached - return only the requested slice
              linesToSend = alreadyFetched.lines.slice(startIdx, endIdx).map(l => ({ n: l.n, text: l.text }));
              startLine = evt.startLine;
              endLine = evt.endLine;
            } else {
              // Invalid range in cache - load from disk
              console.log(`[requestFileContent] Cache invalid for lines ${evt.startLine}-${evt.endLine}, fetching from disk`);
              
              const doc = await vscode.workspace.openTextDocument(uri);
              const text = doc.getText();
              const allLines = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
              
              const actualStartIdx = Math.max(0, evt.startLine - 1);
              const actualEndIdx = Math.min(allLines.length, evt.endLine);
              
              linesToSend = allLines.slice(actualStartIdx, actualEndIdx);
              startLine = evt.startLine;
              endLine = evt.endLine;
            }
          } else {
            // File not cached - load from disk fresh
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const allLines = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t }));
            
            if (sendFullFile) {
              linesToSend = allLines;
              startLine = 1;
              endLine = allLines.length;
            } else {
              const actualStartIdx = Math.max(0, evt.startLine - 1);
              const actualEndIdx = Math.min(allLines.length, evt.endLine);
              
               if (actualStartIdx >= allLines.length || actualStartIdx > actualEndIdx) {
                consecutiveToolFailures.push({
                  toolType: 'fileContent',
                  error: `Invalid line range: ${evt.startLine}-${evt.endLine}`,
                  timestamp: Date.now(),
                  payload: evt
                });

                const optimizationPrompt = consecutiveToolFailures.filter(f => f.toolType === 'fileContent').length >= MAX_CONSECUTIVE_FAILURES
                  ? `\n\nOPTIMIZATION SUGGESTION: The line range is invalid. Use searchInFile first to find the exact location of content, then request a valid line range based on those results.`
                  : '';

                panel.webview.postMessage({
                  type: 'toolResultToLLM',
                  toolType: 'fileContent',
                  success: false,
                  error: `Invalid line range: ${evt.startLine}-${evt.endLine}${optimizationPrompt}`
                });
                break;
              }
              
              linesToSend = allLines.slice(actualStartIdx, actualEndIdx);
              startLine = evt.startLine;
              endLine = evt.endLine;
            }
          }

          // Add to fetched files (will be included in next prompt)
          const fetchedFile: FileContext = {
            uri,
            language: scopeFile.language,
            lines: linesToSend,
            summary: `Fetched content from ${uri.toString()}`,
            tokens: countTextTokens(linesToSend.map(l => l.text).join('\n'))
          };

          // Add to fetched files and track sent tokens
          markFileTokensSpent(fetchedFile.tokens);
          internalAddFetchedFile(fetchedFile);
          
          // Update Context dropdown "Tokens sent to LLM" display
          postFileContextTokens(panel);

          const modeText = sendFullFile ? 'full file' : `offset ${startLine}; limit ${endLine - startLine + 1}`;
          
          // Send result back to webview (webview will create collapsed bubble and feed to LLM)
          panel.webview.postMessage({
            type: 'toolResultToLLM',
            toolType: 'fileContent',
            success: true,
            uri: uri.toString(),
            fullFile: sendFullFile,
            startLine,
            endLine,
            lines: linesToSend.map(l => ({ lineNumber: l.n, text: l.text })),
            summary: `Read file: ${uri.toString().split('/').pop()} - ${modeText}`,
            content: [
              `// File content from ${uri}`,
              `// ${modeText}:`,
              ...linesToSend.map(l => `${l.n}: ${l.text}`)
            ].join('\n')
          });

          consecutiveToolFailures = [];

        } catch (err) {
          panel.webview.postMessage({
            type: 'toolResultToLLM',
            toolType: 'fileContent',
            success: false,
            error: String(err)
          });
        }
        break;
      }

      case 'searchInFile': {
        try {
          const query = evt.query;
          const scopeParam = evt.scope || 'context'; // Default to 'context' (fetched files) instead of 'workspace'
          const maxResults = evt.maxResults || 5;
          
          if (!query || typeof query !== 'string') {
            panel.webview.postMessage({
              type: 'toolResultToLLM',
              toolType: 'search',
              success: false,
              error: 'Invalid searchInFile payload - missing query'
            });
            break;
          }

          // Show "Searching" bubble indicator
          panel.webview.postMessage({
            type: 'showSearchIndicator',
            query: query,
            scope: scopeParam
          });

          let scopeUris: string[] = [];
          
          if (scopeParam === 'context') {
            // Search in fetched context files first, fall back to scope files if none exist
            const fetchedFilesList = getFetchedFiles();
            const scopeFilesList = getScopeFileURIs();
            
            if (fetchedFilesList.length > 0) {
              console.log(`[searchInFile] Searching in ${fetchedFilesList.length} fetched context files`);
              scopeUris = fetchedFilesList.map(f => f.uri.toString());
            } else if (scopeFilesList.length > 0) {
              console.log(`[searchInFile] No fetched files, falling back to ${scopeFilesList.length} scope files`);
              scopeUris = scopeFilesList;
            } else {
              console.log(`[searchInFile] Empty context and scope - no files to search`);
              scopeUris = [];
            }
          } else if (scopeParam === 'scope') {
            // Search in workspace scope files (files added to context panel)
            console.log(`[searchInFile] Searching in ${getScopeFileURIs().length} scope files`);
            scopeUris = getScopeFileURIs();
          } else {
            // Default: search fetched files first, fall back to scope if none exist
            const fetchedUris = getFetchedFiles().map(f => f.uri.toString());
            const scopeUrisList = getScopeFileURIs();
            
            console.log(`[searchInFile] No explicit scope - using ${fetchedUris.length > 0 ? 'fetched' : 'scope'} files`);
            scopeUris = fetchedUris.length > 0 ? fetchedUris : scopeUrisList;
          }

          if (scopeUris.length === 0) {
            consecutiveToolFailures.push({
              toolType: 'search',
              error: `No files in search scope`,
              timestamp: Date.now(),
              payload: evt
            });

            panel.webview.postMessage({
              type: 'toolResultToLLM',
              toolType: 'search',
              success: true,
              query: query,
              scope: scopeParam,
              matches: [],
              summary: `No files in search scope`,
              content: `// Search for "${query}" - No files available in ${scopeParam} scope`
            });
            break;
          }

          const results = await searchWorkspaceFiles(query, scopeUris, maxResults);
          
          if (results.length === 0) {
            consecutiveToolFailures.push({
              toolType: 'search',
              error: `No matches found for query "${query}"`,
              timestamp: Date.now(),
              payload: evt
            });

            const optimizationPrompt = consecutiveToolFailures.filter(f => f.toolType === 'search').length >= MAX_CONSECUTIVE_FAILURES
              ? `\n\nOPTIMIZATION SUGGESTION: The search returned no results. Try using simpler, more general keywords without special characters (e.g., instead of "^def", try "def" or "function").`
              : '';

            panel.webview.postMessage({
              type: 'toolResultToLLM',
              toolType: 'search',
              success: true,
              query: query,
              scope: scopeParam,
              matches: [],
              summary: `Searched for "${query}" in ${scopeParam} scope - found 0 matches${optimizationPrompt}`,
              content: `// Search for "${query}" returned no results.${optimizationPrompt}`
            });
            break;
          }

          consecutiveToolFailures = [];

          // Count ALL tokens that will be sent to LLM (including metadata comments)
          const resultContent = [
            `// Search results for "${query}" (${scopeParam} scope)`,
            ...results.map(m => `- ${m.uri}:${m.line} - ${m.text}`)
          ].join('\n');
          
          // Increment Tools session token counter with search result tokens
          const searchTokens = countTextTokens(resultContent);
          addToolTokens(searchTokens);

          panel.webview.postMessage({
            type: 'toolResultToLLM',
            toolType: 'search',
            success: true,
            query: query,
            scope: scopeParam,
            matches: results.map(r => ({
              uri: r.uri,
              line: r.line,
              text: r.text
            })),
            summary: `Searched for "${query}" in ${scopeParam} scope - found ${results.length} matches`,
            content: resultContent
          });

        } catch (err) {
          consecutiveToolFailures.push({
            toolType: 'search',
            error: String(err),
            timestamp: Date.now(),
            payload: evt
          });

          panel.webview.postMessage({
            type: 'toolResultToLLM',
            toolType: 'search',
            success: false,
            error: String(err)
          });
        }
        break;
      }





      case 'refreshApiStatus': {
        updateApiStatus(panel);
        break;
      }

      case 'editFile': {
        await dispatchToolCall(evt, panel);
        break;
      }


      case 'toggleCapability': {
        handleToggleCapability(evt, panel);
        break;
      }

      case 'refreshCapabilities': {
        sendCapabilities(panel);
        break;
      }




    }
  });
}

async function handleSendToAI(
  panel: vscode.WebviewPanel,
  rawMessage: string,
  mode: 'chat' | 'validate' | 'complete' = 'chat',
  fileContextOverride?: string,        // now unused for token counting
  languageOverride?: string,
  isToolResult: boolean = false
) {
  (handleSendToAI as any).callCount = ((handleSendToAI as any).callCount || 0) + 1;
  console.log(`[handleSendToAI #${(handleSendToAI as any).callCount}] ENTERED - isToolResult=${isToolResult}, message length=${rawMessage?.length || 0}`);
  
  const userMessage = rawMessage?.trim();
  if (!userMessage) {
    console.log(`[handleSendToAI] Empty message, returning early`);
    return;
  }

  // Guard against rapid-fire clicks - silently ignore if already streaming
  // BUT allow tool results to go through (they're part of the response chain)
  if (isStreamingActive(panel) && !isToolResult) {
    return;
  }

  const isFirstTurn = conversation.length === 0;
  const apiType = getConfig<string>('apiLLM.config.apiType', 'openai');
  const model = getConfig<string>('apiLLM.config.model', '');

  let language: string | undefined = languageOverride;
  if (!language) {
    try {
      language = await getLanguage();
    } catch {}
  }

  // Mark the turn as using streaming and pause health checks
  setStreamingActive(panel, true);
  stopHealthLoop();

  // 1) Build the two-part prompt (system + user) from current context
  const promptContext: PromptContext = {
    code: userMessage,
    mode,
    
    // ONLY include fetched files (content actually sent to LLM via tools)
    fileContexts: getFetchedFiles().map(f => ({
      uri: f.uri.toString(),
      language: f.language,
      summary: f.summary,
      slices: [{ 
        startLine: 1, 
        endLine: f.lines.length, 
        lines: f.lines 
      }] // Full content of fetched files (mode already applied during fetch)
    })),

    language,
    // Pass through current capabilities
    capabilities: { 
      editFile: canEditFiles(),
      requestFileContent: canRequestFileContent(),
      searchInFile: canSearchInFile()
    },
    
    // Scope URIs for tool discovery (NO CONTENT included)
    scopeUris: getScopeFileURIs()
  };

  const built = apiType === 'ollama'
    ? buildOllamaMessages(promptContext)
    : buildOpenAIMessages(promptContext);


  const newSystem = built[0];
  const newUser   = built[1];

  // 2) Always ensure conversation[0] is the latest system message
  const beforeTokens = countMessageTokens(conversation);
  if (conversation.length === 0) {
    conversation.push(newSystem);
  } else if (conversation[0]?.role === 'system') {
    conversation[0] = newSystem;
  } else {
    conversation.unshift(newSystem);
  }

  // Calculate token usage for this turn upfront
  const userTurnTokens = countMessageTokens([newUser]);

  console.log(`[handleSendToAI] isToolResult=${isToolResult}, conversation length before=${conversation.length}`);
  if (isToolResult) {
    console.log(`[handleSendToAI] Tool result content:`, newUser.content.substring(0, 200));
  }

  // 3) Push the message (user or tool result depending on isToolResult flag)
  if (isToolResult) {
    console.log(`[handleSendToAI] Tool result flow - last message role: ${conversation[conversation.length - 1]?.role}`);
    
    // Tool results should be appended to the last assistant message to avoid consecutive assistant messages
    const lastMessage = conversation[conversation.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      // Append tool result to existing assistant message
      console.log(`[handleSendToAI] Appending tool result to assistant message with content length: ${lastMessage.content.length}`);
      lastMessage.content += '\n\n' + newUser.content;
      console.log(`[handleSendToAI] Appended tool result, new assistant content length: ${lastMessage.content.length}`);
    } else {
      // No assistant message exists yet, create one
      conversation.push({ role: 'assistant', content: newUser.content });
      console.log(`[handleSendToAI] Created new assistant message for tool result`);
    }
    
    // CRITICAL: Add a follow-up user message to prompt the LLM to continue responding
    const continuationPrompt = "Please continue with your response using this information.";
    conversation.push({ role: 'user', content: continuationPrompt });
    console.log(`[handleSendToAI] Added continuation prompt, new conversation length=${conversation.length}`);
    
    // Log the last 3 messages for debugging tool call flow
    const last3 = conversation.slice(-3).map(m => ({ role: m.role, contentPreview: m.content.substring(0, 50) }));
    console.log(`[handleSendToAI] Last 3 messages before continuation:`, JSON.stringify(last3));
   } else {
    conversation.push({ role: 'user', content: newUser.content });

    // Add chat tokens for the user prompt to the session total
    addChatTokens(userTurnTokens);
  }


   // 5) Warn if over limit (only for user messages, not tool results)
  if (!isToolResult) {
    const total = countMessageTokens(conversation);
    const contextSize = getMaxContextTokens();
    if (total > contextSize) {
      vscode.window.showWarningMessage(
        `Your conversation uses ${total} tokens, exceeding your limit of ${contextSize}.`
      );
    }

    // 6) Append user bubble for non-tool-result messages
    panel.webview.postMessage({
      type: 'appendUser',
      message: newUser.content,
      chatTokens: userTurnTokens ?? 0
    });
  }

   refreshTokenStats(panel);

  console.log(`[handleSendToAI] Sending to API, messages:`, JSON.stringify(conversation.map(m => ({ role: m.role, content: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '') }))));

  const controller = new AbortController();
  abortControllers.set(panel, controller);

  try {
    await routeChatRequest({
      model,
      messages: conversation,
      signal: controller.signal,
      panel,
      onToken: (chunk) => {
        if (!isStreamingActive(panel)) return;
        const chunkTokens = countTextTokens(chunk);
        // Add streaming tokens to chat-only session counter
        addChatTokens(chunkTokens);
        refreshTokenStats(panel);
      },
      onDone: () => {
        console.log(`[handleSendToAI] Streaming complete, calling onDone`);
        startHealthLoop(panel);
        // DON'T clear streaming flag here - it should stay active until explicit stop or error
        // This allows tool result continuations to stream normally without race conditions
      }
    });
    console.log(`[handleSendToAI] routeChatRequest completed successfully`);
    // Streaming flag is now cleared in streamingHandler.ts finalize() after all chunks are sent
  } catch (err) {
    setStreamingActive(panel, false);
    panel.webview.postMessage({ type: 'earlyEnd', reason: 'Unknown Error' });
    await updateApiStatus(panel);
    throw err;
  }
}

async function handleInsertCode(message: string) {
  if (!message) return;
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    vscode.window.showWarningMessage('No active editor.');
    return;
  }
  const sel = ed.selection;
  const targetIndent = ed.document.lineAt(sel.active.line).text.match(/^\s*/)?.[0] ?? '';

  const raw = String(message).replace(/\r\n/g, '\n');
  const lines = raw.split('\n');

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const minIndentLen = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => (l.match(/^[ \t]*/)?.[0].length) ?? 0))
    : 0;

  const reindented = lines
    .map((l) => {
      if (l.trim().length === 0) return '';
      return targetIndent + l.slice(minIndentLen);
    })
    .join('\n');

  await ed.edit((edit) => {
    if (!sel.isEmpty) {
      edit.replace(sel, reindented);
    } else {
      edit.insert(sel.active, reindented);
    }
  });
}
