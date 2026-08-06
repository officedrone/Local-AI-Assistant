// src/handlers/chatPanel/chatPanelMessages.ts
import * as vscode from 'vscode';
import { getConfig, getMaxContextTokens, updateApiStatus } from './chatPanelConfig';
import { postFileContextTokens, refreshTokenStats } from './chatPanelTokens';
import {
  getCodeEditor,
  addFileToContext,
  removeFileFromContext,
  addAllOpenEditorsToContext,
  clearContextFiles,
  getContextFiles,
  extractRelevantSlices,
  saveSessionContextState,
  restoreSessionContextState
} from './chatPanelContext';


//Agent imports
import { handleEditMessage, handleRequestPreview } from '../agent/agentToolsVSFiles';
import { handleToggleCapability, sendCapabilities, canEditFiles } from '../agent/agentToolsCapabilityMgr';
import { dispatchToolCall } from '../agent/agentToolsIndex';


import { chatPrompt } from '../../static/prompts';





//Token Count imports
import {
  countMessageTokens,
  countTextTokens,
  getFileContextTokens,
  addChatTokens,
  resetSessionTokenCount,
  getEffectiveFileContextTokens,
  markFileTokensSpent,
  setStreamingActive,
  isStreamingActive
} from '../../commands/tokenActions';

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
let pendingFileTokens: number | null = null;
let pendingFileUris: string[] = [];
let seenFiles = new Set<string>();
let spentFiles = new Set<string>(); // URIs whose tokens have already been spent in this session

// Multi-file context function to keep track of context
function updatePendingFileTokens() {
  const current = getContextFiles().map(f => ({
    uri: f.uri.toString(),
    tokens: f.tokens,
  }));

  // Files newly present compared to lastContextState and not already spent this session
  const newFiles = current.filter(
    c =>
      !lastContextState.some(prev => prev.uri === c.uri) &&
      !seenFiles.has(c.uri) &&
      !spentFiles.has(c.uri)
  );

  const newTokens = newFiles.reduce((sum, f) => sum + f.tokens, 0);

  // *** Accumulate instead of overwrite ***
  if (newTokens > 0) {
    pendingFileTokens = (pendingFileTokens ?? 0) + newTokens;
    pendingFileUris.push(...newFiles.map(f => f.uri));
  } else {
    pendingFileTokens = null;      // nothing new
    pendingFileUris = [];
  }

  // Mark these files as "seen"
  newFiles.forEach(f => seenFiles.add(f.uri));

  lastContextState = current;
}



export function attachMessageHandlers(panel: vscode.WebviewPanel, onDispose: () => void) {
  panel.webview.onDidReceiveMessage(async (evt) => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    switch (evt.type) {

      // Multi-file context cases
      case 'addFileToContext': {
        if (evt.uri) {
          await addFileToContext(vscode.Uri.parse(evt.uri));
          
          const files = getContextFiles();
          const fullCount = files.filter(f => f.sendFullFile === true).length;
          const smartCount = files.length - fullCount;
          const defaultMode = smartCount >= fullCount ? false : true;
          
          files.forEach(f => {
            if (f.sendFullFile === undefined) {
              f.sendFullFile = defaultMode;
            }
          });
          
          updatePendingFileTokens();
        }
        break;
      }

      case 'addCurrent': {
      // Ensure an editor is focused so activeTextEditor is set
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

      const ed = vscode.window.activeTextEditor;
      if (ed) {
        await addFileToContext(ed.document.uri);
        
        const files = getContextFiles();
        const fullCount = files.filter(f => f.sendFullFile === true).length;
        const smartCount = files.length - fullCount;
        const defaultMode = smartCount >= fullCount ? false : true;
        
        const addedFile = files[files.length - 1];
        if (addedFile && addedFile.sendFullFile === undefined) {
          addedFile.sendFullFile = defaultMode;
        }
        
        updatePendingFileTokens();
        lastContextState = getContextFiles().map(f => ({ uri: f.uri.toString(), tokens: f.tokens }));

        // Update UI immediately
        const filesForUI = getContextFiles().map(f => ({
          uri: f.uri.toString(),
          language: f.language,
          tokens: f.tokens
        }));
        panel.webview.postMessage({ type: 'contextUpdated', files: filesForUI });
      } else {
        vscode.window.showWarningMessage('No active editor to add.');
      }
      break;
    }

      case 'addEditors': {
        await addAllOpenEditorsToContext();
        
        const files = getContextFiles();
        const fullCount = files.filter(f => f.sendFullFile === true).length;
        const smartCount = files.length - fullCount;
        const defaultMode = smartCount >= fullCount ? false : true;
        
        files.forEach(f => {
          if (f.sendFullFile === undefined) {
            f.sendFullFile = defaultMode;
          }
        });
        
        updatePendingFileTokens();
        lastContextState = getContextFiles().map(f => ({ uri: f.uri.toString(), tokens: f.tokens }));

        // Update UI immediately
        const filesForUI = getContextFiles().map(f => ({
          uri: f.uri.toString(),
          language: f.language,
          tokens: f.tokens,
          sendFullFile: f.sendFullFile ?? false
        }));
        panel.webview.postMessage({ type: 'contextUpdated', files: filesForUI });
        break;
      }


      case 'pickAndAddFile': {
        // 1) showOpenDialog in extension land
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Add to Context'
        });
        // 2) push each picked file into your shared helper
        if (uris) {
          for (const uri of uris) {
            await addFileToContext(uri);
          }
          
          const files = getContextFiles();
          const fullCount = files.filter(f => f.sendFullFile === true).length;
          const smartCount = files.length - fullCount;
          const defaultMode = smartCount >= fullCount ? false : true;
          
          files.forEach(f => {
            if (f.sendFullFile === undefined) {
              f.sendFullFile = defaultMode;
            }
          });
          
          updatePendingFileTokens();
        }
        break;
      }

      case 'removeFileFromContext': {
        if (evt.uri) {
          const uri = vscode.Uri.parse(evt.uri);
          removeFileFromContext(uri);
          updatePendingFileTokens();

          // Forget only "seen" state so diffs remain accurate; do NOT clear spentFiles
          seenFiles.delete(uri.toString());
          lastContextState = getContextFiles().map(f => ({ uri: f.uri.toString(), tokens: f.tokens }));
        }
        break;
      }


      case 'clearContext': {
        clearContextFiles();
        updatePendingFileTokens();
        break;
      }

      case 'toggleFileMode': {
        if (evt.uri) {
          const uri = vscode.Uri.parse(evt.uri);
          const file = getContextFiles().find(f => f.uri.toString() === uri.toString());
          
          if (file) {
            file.sendFullFile = evt.sendFullFile ?? false;
            
            lastContextState = getContextFiles().map(f => ({ 
              uri: f.uri.toString(), 
              tokens: f.tokens 
            }));
            
            panel.webview.postMessage({
              type: 'contextUpdated',
              files: getContextFiles().map(f => ({
                uri: f.uri.toString(),
                language: f.language,
                tokens: f.tokens,
                sendFullFile: f.sendFullFile ?? false
              }))
            });
          }
        }
        break;
      }

      case 'setAllMode': {
        const newMode = evt.mode === 'full';
        
        getContextFiles().forEach(f => {
          f.sendFullFile = newMode;
        });
        
        lastContextState = getContextFiles().map(f => ({ 
          uri: f.uri.toString(), 
          tokens: f.tokens 
        }));
        
        panel.webview.postMessage({
          type: 'contextUpdated',
          files: getContextFiles().map(f => ({
            uri: f.uri.toString(),
            language: f.language,
            tokens: f.tokens,
            sendFullFile: f.sendFullFile ?? false
          }))
        });
        
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

        // Regular sendToAI flow for chat/validation/completion
        await handleSendToAI(
          panel,
          evt.message,
          evt.mode,
          undefined,        // always use extension-side context
          evt.language
        );
        break;
      }



      case 'stopGeneration':
        setStreamingActive(panel, false);
        {
          const controller = abortControllers.get(panel);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
        }
        // Tell the webview to replace the placeholder with "Message Aborted by User" if no chunks yet
        panel.webview.postMessage({ type: 'earlyEnd', reason: '(Message Aborted by User)' });
        startHealthLoop(panel); // resume health checks
        break;

      case 'openSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:officedrone.local-ai-assistant'
        );
        break;

      case 'newSession': {
        // Stop any active generation
        setStreamingActive(panel, false);
        {
          const controller = abortControllers.get(panel);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
        }
        panel.webview.postMessage({ type: 'earlyEnd', reason: '(Message Aborted by User)' });

        resetSessionTokenCount();
        conversation = [];
        lastFileContextTokens = 0;

        // Save current session state including file modes
        const savedState = saveSessionContextState();

        // Reset multi-file tracking
        seenFiles.clear();
        spentFiles.clear();
        pendingFileTokens = null;
        pendingFileUris = [];
        lastContextState = [];

        panel.dispose();
        onDispose();

        const newPanel = getOrCreateChatPanel();

        // Restore context files with their modes preserved
        await restoreSessionContextState();

        updatePendingFileTokens();
        lastContextState = getContextFiles().map(f => ({ uri: f.uri.toString(), tokens: f.tokens }));

        const files = getContextFiles().map(f => ({
          uri: f.uri.toString(),
          language: f.language,
          tokens: f.tokens,
          sendFullFile: f.sendFullFile ?? false
        }));
        newPanel.webview.postMessage({ type: 'contextUpdated', files });

        lastFileContextTokens = getEffectiveFileContextTokens();
        postFileContextTokens(newPanel);
        refreshTokenStats(newPanel);
        updateApiStatus(newPanel);
        break;
      }




      case 'stopStream': {
        // turn off streaming flag
        setStreamingActive(panel, false);

        // abort the in-flight request
        {
          const controller = abortControllers.get(panel);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
        }

        // trigger UI cleanup in the webview (no "no response" placeholder)
        panel.webview.postMessage({ type: 'stopStream' });

        // resume health checks
        startHealthLoop(panel);
        break;
      }

      case 'insertCode':
        await handleInsertCode(evt.message);
        break;

      case 'invokeCommand':
        if (evt.command) {
          vscode.commands.executeCommand(evt.command);
        }
        break;

      case 'webviewReady': {
        // Ensure the UI reflects current extension state
        updateApiStatus(panel);

        // Try to focus an editor so vscode.window.activeTextEditor is available.
        // This avoids the cold-start race where the webview grabs focus before we read the active editor.
        try {
          await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        } catch {}

        // Auto-add the active editor file (only if there's an active editor)
        const active = vscode.window.activeTextEditor;
        if (active) {
          await addFileToContext(active.document.uri);

          // Compute pending tokens for the startup file (so first send will spend them)
          updatePendingFileTokens();
          lastContextState = getContextFiles().map(f => ({
            uri: f.uri.toString(),
            tokens: f.tokens
          }));
        }

        // Send full context with mode information to preserve restored states
        const files = getContextFiles().map(f => ({
          uri: f.uri.toString(),
          language: f.language,
          tokens: f.tokens,
          sendFullFile: f.sendFullFile ?? false
        }));
        panel.webview.postMessage({ type: 'contextUpdated', files });

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
  languageOverride?: string
) {
  const userMessage = rawMessage?.trim();
  if (!userMessage) return;

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
    fileContexts: getContextFiles().map(f => ({
      uri: f.uri.toString(),
      language: f.language,
      summary: f.summary,
      slices: extractRelevantSlices(f, userMessage)
    })),

    language,
    // Pass through current capabilities
    capabilities: { editFile: canEditFiles() }
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

  // 3) Push the user prompt
  conversation.push({ role: 'user', content: newUser.content });

   // 4) Calculate token usage for this turn
    // NEW: count ONLY the user prompt tokens for the bubble
  const userTurnTokens = countMessageTokens([newUser]);

  // Add chat tokens for the user prompt to the session total
  addChatTokens(userTurnTokens);

  // Spend pending diff when present; otherwise on first turn spend effective tokens.
  // Mark the corresponding URIs as spent to prevent re-add double-counting.
  const pending = pendingFileTokens ?? 0;
  if (pending > 0) {
    markFileTokensSpent(pending);
    for (const uri of pendingFileUris) {
      spentFiles.add(uri);
    }
    pendingFileTokens = null;
    pendingFileUris = [];
  } else if (isFirstTurn) {
    const effective = getEffectiveFileContextTokens();
    if (effective > 0) {
      markFileTokensSpent(effective);
      for (const f of getContextFiles()) {
        spentFiles.add(f.uri.toString());
      }
    }
  }



  // 5) Warn if over limit
  const total = countMessageTokens(conversation);
  const contextSize = getMaxContextTokens();
  if (total > contextSize) {
    vscode.window.showWarningMessage(
      `Your conversation uses ${total} tokens, exceeding your limit of ${contextSize}.`
    );
  }

  // 6) Append user bubble
  panel.webview.postMessage({
    type: 'appendUser',
    message: newUser.content,
    chatTokens: userTurnTokens,
    fileTokens: pendingFileTokens ?? 0
  });

  // Reset after using once
  pendingFileTokens = null;

  refreshTokenStats(panel);

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
      onDone: () => startHealthLoop(panel)
    });
    setStreamingActive(panel, false);
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
