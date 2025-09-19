// src/handlers/chatPanel/chatPanelMessages.ts
import * as vscode from 'vscode';
import { getConfig, getMaxContextTokens, updateApiStatus } from './chatPanelConfig';
import { postFileContextTokens, refreshTokenStats } from './chatPanelTokens';
import { getCodeEditor } from './chatPanelContext';
import {
  countMessageTokens,
  countTextTokens,
  getFileContextTokens,
  addToSessionTokenCount,
  resetSessionTokenCount,
  getEffectiveFileContextTokens,
  setStreamingActive,
  isStreamingActive
} from '../../commands/tokenActions';
import { shouldIncludeContext, markContextDirty } from '../contextHandler';
import { buildOpenAIMessages, buildOllamaMessages, PromptContext, getLanguage } from '../../commands/promptBuilder';
import { routeChatRequest, stopHealthLoop, startHealthLoop } from '../../api/apiRouter';
import { getOrCreateChatPanel } from './chatPanelLifecycle';

const CONFIG_SECTION = 'localAIAssistant';
export const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();


let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
let lastFileContextTokens = 0;

export function attachMessageHandlers(panel: vscode.WebviewPanel, onDispose: () => void) {
  panel.webview.onDidReceiveMessage(async (evt) => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    switch (evt.type) {
      case 'toggleIncludeFileContext':
        if (typeof evt.value === 'boolean') {
          await config.update('context.includeFileContext', evt.value, vscode.ConfigurationTarget.Global);
          postFileContextTokens(panel);
        }
        break;

      case 'sendToAI': {
        stopHealthLoop(); // pause health checks while streaming
        await handleSendToAI(
          panel,
          evt.message,
          evt.mode,  
          evt.fileContext,
          evt.language
        );
        break;
      }



      case 'stopGeneration':
        setStreamingActive(panel, false);
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
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
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        // Tell the webview to clean up its UI
        panel.webview.postMessage({ type: 'earlyEnd', reason: '(Message Aborted by User)' });

        resetSessionTokenCount();
        conversation = [];
        lastFileContextTokens = 0;
        panel.dispose();
        onDispose();

        const newPanel = getOrCreateChatPanel();
        lastFileContextTokens = getEffectiveFileContextTokens();
        refreshTokenStats(newPanel);
        updateApiStatus(newPanel);
        break;
      }

      case 'stopStream': {
        // turn off streaming flag
        setStreamingActive(panel, false);

        // abort the in-flight request
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }

        // trigger UI cleanup in the webview (no “no response” placeholder)
        panel.webview.postMessage({ type: 'stopStream' });

        // resume health checks
        startHealthLoop(panel);
        break;
      }


      case 'insertCode':
        await handleInsertCode(evt.message);
        break;

      case 'requestIncludeFileContext':
        panel.webview.postMessage({
          type: 'includeFileContext',
          value: getConfig<boolean>('context.includeFileContext', true)
        });
        break;

      case 'invokeCommand':
        if (evt.command) {
          vscode.commands.executeCommand(evt.command);
        }
        break;

      case 'webviewReady':
      case 'refreshApiStatus':
        updateApiStatus(panel);
        break;
    }
  });
}

async function handleSendToAI(
  panel: vscode.WebviewPanel,
  rawMessage: string,
  mode: 'chat' | 'validate' | 'complete' = 'chat',
  fileContextOverride?: string,
  languageOverride?: string
) {
  const userMessage = rawMessage?.trim();
  if (!userMessage) return;

  const isFirstTurn = conversation.length === 0;
  const includeCtx = getConfig<boolean>('context.includeFileContext', true);
  const apiType = getConfig<string>('apiLLM.config.apiType', 'openai');
  const model = getConfig<string>('apiLLM.config.model', '');

  const ed = getCodeEditor();
  const text = ed?.document.getText() ?? '';

  const includeFileThisTurn = includeCtx && shouldIncludeContext(text, isFirstTurn);
  const fileContext = fileContextOverride ?? (includeFileThisTurn ? text : undefined);

  let language: string | undefined = languageOverride;
  if (!language) {
    try {
      language = await getLanguage();
    } catch {}
  }

  setStreamingActive(panel, true);
  stopHealthLoop();

  // 1) Build the two-part prompt (system + user) for this mode
  const promptContext: PromptContext = {
    code: userMessage,
    mode,
    fileContext,
    language
  };
  const built = apiType === 'ollama'
    ? buildOllamaMessages(promptContext)
    : buildOpenAIMessages(promptContext);

  // Destructure system & user messages
  const newSystem = built[0];
  const newUser   = built[1];

  // 2) Insert or update the system message in the conversation
  const beforeTokens = countMessageTokens(conversation);
  if (isFirstTurn) {
    conversation.push(newSystem);
  } else if (conversation[0]?.role !== 'system') {
    conversation.unshift(newSystem);
  } else if (includeFileThisTurn) {
    conversation[0] = newSystem;
  }

  // 3) Push the *built* user prompt (with markdown fences!)  
  conversation.push({ role: 'user', content: newUser.content });

  // 4) Recount tokens to figure out just the user-turn delta
  const afterTokens = countMessageTokens(conversation);
  let userTurnTokens = Math.max(0, afterTokens - beforeTokens);
  if (isFirstTurn && includeFileThisTurn) {
    const ctxTokens = getFileContextTokens();
    userTurnTokens = Math.max(0, userTurnTokens - ctxTokens);
  }
  const fileTokenCount = fileContext ? countTextTokens(fileContext) : 0;
  addToSessionTokenCount(userTurnTokens, fileTokenCount);

  // Check total context size
  const total = countMessageTokens(conversation);
  const contextSize = getMaxContextTokens();
  if (total > contextSize) {
    vscode.window.showWarningMessage(
      `Your conversation uses ${total} tokens, exceeding your limit of ${contextSize}.`
    );
  }

  // 5) Append built user prompt as single markdown-rendered bubble
  panel.webview.postMessage({
    type: 'appendUser',
    message: newUser.content,
    tokens: userTurnTokens
  });
  refreshTokenStats(panel);

  // 6) Start the stream
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
        addToSessionTokenCount(chunkTokens, 0);
        refreshTokenStats(panel);
      },
      onDone: () => {
        // Normal completion — restart health checks
        startHealthLoop(panel);
      }
    });
    setStreamingActive(panel, false);
  } catch (err) {
    setStreamingActive(panel, false);
    // Tell the webview to replace the placeholder with "Unknown Error" if no chunks yet
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
