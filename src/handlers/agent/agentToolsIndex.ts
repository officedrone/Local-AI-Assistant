// src/handlers/agent/agentToolsIndex.ts
import * as vscode from 'vscode';
import { EditMessage } from './agentToolsVSFiles';
import { canEditFiles } from './agentToolsCapabilityMgr';

type ToolHandler = (payload: any, panel: vscode.WebviewPanel) => Promise<void>;

const toolHandlers: Record<string, ToolHandler> = {
  editFile: async (_payload, _panel) => {
    // Intentionally empty: we no longer auto-apply here.
    // The actual edit happens only after the user clicks "Approve",
    // which triggers 'confirmEdit' → handleEditMessage in chatPanelMessages.ts.
  },
  requestFileContent: async (payload, panel) => {
    // This tool is handled directly by chatPanelMessages.ts
    // No additional dispatch logic needed here
  },
  searchInFile: async (payload, panel) => {
    // This tool is handled directly by chatPanelMessages.ts
    // No additional dispatch logic needed here
  }
};

export async function dispatchToolCall(payload: any, panel: vscode.WebviewPanel) {
  try {
    const handler = toolHandlers[payload?.type];
    if (handler) {
      // Handle editFile specially - show preview
      if (payload?.type === 'editFile') {
        const msg = payload as EditMessage;
        panel.webview.postMessage({
          type: 'editPreview',
          uri: msg.uri,
          content: msg.edits.map((e) => e.newText ?? '').join('\n'),
          edits: msg.edits,
          preview: ''
        });
      }
      
      await handler(payload, panel);
    } else {
      panel.webview.postMessage({
        type: 'toolResult',
        tool: payload?.type ?? 'unknown',
        success: false,
        error: 'Unknown tool'
      });
    }
  } catch (err) {
    panel.webview.postMessage({
      type: 'toolResult',
      tool: payload?.type ?? 'unknown',
      success: false,
      error: String(err)
    });
  }
}

function stripSpecialChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '').trim();
}

export async function searchWorkspaceFiles(
  query: string,
  scopeUris?: string[],
  maxResults: number = 5
): Promise<{ uri: string; line: number; text: string }[]> {
  const results: { uri: string; line: number; text: string }[] = [];
  
  if (!query || query.trim().length === 0) {
    return results;
  }

  let searchQuery = query.trim();
  let triedFallback = false;

  const searchUris = scopeUris && scopeUris.length > 0 
    ? scopeUris.map(uri => vscode.Uri.parse(uri))
    : [];

  const searchInFiles = async (uris: vscode.Uri[], attemptNum: number): Promise<void> => {
    for (const uri of uris.slice(0, maxResults * 3)) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const lines = doc.getText().split(/\r?\n/);
        
        const lowerQuery = searchQuery.toLowerCase();
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              uri: uri.toString(),
              line: i + 1,
              text: lines[i].trim()
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to search file ${uri.toString()}:`, err);
      }
    }
  };

  const searchAllWorkspace = async (attemptNum: number): Promise<void> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    for (const folder of workspaceFolders) {
      try {
        const files = await vscode.workspace.findFiles(
          '**/*',
          '{node_modules,.git,*.min.js,dist,build,out}',
          100
        );

        for (const uri of files) {
          if (results.length >= maxResults) break;
          
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const lines = doc.getText().split(/\r?\n/);
            
            const lowerQuery = searchQuery.toLowerCase();
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                  uri: uri.toString(),
                  line: i + 1,
                  text: lines[i].trim()
                });
              }
            }
          } catch (err) {
            // Skip binary or unreadable files
          }
        }
      } catch (err) {
        console.warn(`Failed to search workspace folder ${folder.name}:`, err);
      }
    }
  };

  if (searchUris.length > 0) {
    await searchInFiles(searchUris, 1);
    
    if (results.length === 0 && !triedFallback) {
      const fallbackQuery = stripSpecialChars(searchQuery);
      if (fallbackQuery !== searchQuery && fallbackQuery.length > 0) {
        console.log(`[searchWorkspaceFiles] No matches for "${searchQuery}", trying stripped: "${fallbackQuery}"`);
        searchQuery = fallbackQuery;
        triedFallback = true;
        await searchInFiles(searchUris, 2);
      }
    }
  } else {
    await searchAllWorkspace(1);
    
    if (results.length === 0 && !triedFallback) {
      const fallbackQuery = stripSpecialChars(searchQuery);
      if (fallbackQuery !== searchQuery && fallbackQuery.length > 0) {
        console.log(`[searchWorkspaceFiles] No matches for "${searchQuery}", trying stripped: "${fallbackQuery}"`);
        searchQuery = fallbackQuery;
        triedFallback = true;
        await searchAllWorkspace(2);
      }
    }
  }

  return results;
}
