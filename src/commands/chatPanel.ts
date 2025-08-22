import * as vscode from 'vscode';
import {
  buildOpenAIMessages,
  buildOllamaMessages,
  PromptContext,
  getLanguage
} from './promptBuilder';
import { getWebviewContent } from '../static/chatPanelView';
import {
  countMessageTokens,
  countTextTokens,
  getFileContextTokens,
  addToSessionTokenCount,
  getSessionTokenCount,
  resetSessionTokenCount,
  getEffectiveFileContextTokens,
  setStreamingActive,
  isStreamingActive
} from './tokenActions';
import { routeChatRequest } from '../api/apiRouter';
import {
  markContextDirty,
  shouldIncludeContext,
  getFileContext
} from '../handlers/contextHandler';

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
let extensionContext: vscode.ExtensionContext;
let lastFileContextTokens = 0;

// tracks the history of messages
let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

// Helper to read from our extension's configuration
function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue);
}

// Returns the max context-size setting
function getMaxContextTokens(): number {
  return getConfig<number>('context.contextSize', 4096);
}

// Shortcut for posting a `{ type, value }` message
function postToWebview(panel: vscode.WebviewPanel, type: string, value: any): void {
  panel.webview.postMessage({ type, value });
}

// Posts the current session tokens + effective file tokens
function refreshTokenStats(panel: vscode.WebviewPanel): void {
  postSessionTokenUpdate(panel, getSessionTokenCount(), getEffectiveFileContextTokens());
}

// Sends the LLM URL and API type from settings into the webview
function sendInitialSettings(panel: vscode.WebviewPanel): void {
  const initialUrl = (getConfig<string>('apiLLM.apiURL.endpoint', '')?.trim() || 'None');
  const initialApiType = (getConfig<string>('apiLLM.config.apiType', '')?.trim() || 'None');
  postToWebview(panel, 'setLLMUrl', initialUrl);
  postToWebview(panel, 'setApiType', initialApiType);
}

// Code editor definition for context purposes (ignores the webview)
function getCodeEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.scheme !== 'vscode-webview') {
    return active;
  }
  return vscode.window.visibleTextEditors.find(
    (ed) => ed.document.uri.scheme !== 'vscode-webview'
  );
}

export function getActiveChatPanel(): vscode.WebviewPanel | undefined {
  return chatPanel;
}

export function registerChatPanelCommand(context: vscode.ExtensionContext) {
  extensionContext = context;

  // React to changes in our key settings
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (!chatPanel) {
      return;
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.apiURL.endpoint`)) {
      postToWebview(chatPanel, 'setLLMUrl', (getConfig<string>('apiLLM.apiURL.endpoint', '')?.trim() || 'None'));
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.config.apiType`)) {
      postToWebview(chatPanel, 'setApiType', (getConfig<string>('apiLLM.config.apiType', '')?.trim() || 'None'));
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.context.contextSize`)) {
      postToWebview(chatPanel, 'contextSize', getMaxContextTokens());
    }
  });

  // Watch for model changes separately
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (chatPanel && e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.config.model`)) {
      const updatedModel = (getConfig<string>('apiLLM.config.model', '')?.trim() || 'None');
      postToWebview(chatPanel, 'setModel', updatedModel);
    }
  });

  // When a text document changes, mark context dirty & push new token counts
  vscode.workspace.onDidChangeTextDocument((e) => {
    markContextDirty(e.document);
    if (chatPanel) {
      postFileContextTokens(chatPanel);
    }
  });

  // When the user switches editors, recalc & push tokens
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (chatPanel && editor && editor.document.uri.scheme !== 'vscode-webview') {
        postFileContextTokens(chatPanel);
      }
    })
  );

  // Register the "Open Chat" command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.openChatPanel', () => {
      if (chatPanel) {
        chatPanel.reveal(vscode.ViewColumn.Two);
        postFileContextTokens(chatPanel);
      } else {
        getOrCreateChatPanel();
      }
    })
  );
}

export function postSessionTokenUpdate(
  panel: vscode.WebviewPanel,
  sessionTokens: number,
  fileContextTokens: number
): void {
  panel.webview.postMessage({
    type: 'sessionTokenUpdate',
    sessionTokens,
    fileContextTokens,
    totalTokens: sessionTokens + fileContextTokens
  });
}

export function getOrCreateChatPanel(): vscode.WebviewPanel {
  if (chatPanel) {
    chatPanel.reveal(vscode.ViewColumn.Two);
    postFileContextTokens(chatPanel);
    refreshTokenStats(chatPanel);
    return chatPanel;
  }

  conversation = [];

  // Split the editor in a 2:1 ratio
  vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{ size: 2 }, { size: 1 }]
  });

  chatPanel = vscode.window.createWebviewPanel(
    'LocalAIAssistantChat',
    'Local AI Assistant Chat',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  chatPanel.onDidDispose(() => {
    chatPanel = undefined;
  });

  chatPanel.webview.html = getWebviewContent(extensionContext, chatPanel);

  sendInitialSettings(chatPanel);
  postFileContextTokens(chatPanel);

  chatPanel.webview.onDidReceiveMessage(async (evt) => {
    const panel = chatPanel!;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    switch (evt.type) {
      case 'toggleIncludeFileContext': {
        if (typeof evt.value === 'boolean') {
          await config.update(
            'context.includeFileContext',
            evt.value,
            vscode.ConfigurationTarget.Global
          );
          postFileContextTokens(panel);
        }
        return;
      }

      case 'sendToAI': {
        const userMessage = evt.message?.trim();
        if (!userMessage) {
          return;
        }

        // Is this the very first turn?
        const isFirstTurn = conversation.length === 0;

        // Read config values
        const includeCtx = getConfig<boolean>('context.includeFileContext', true);
        const apiType = getConfig<string>('apiType', 'openai');
        const model = getConfig<string>('model', '');

        // Always read from a real editor even if the webview is focused
        const ed = getCodeEditor();
        const text = ed?.document.getText() ?? '';

        // Decide whether to include file context this turn
        const includeFileThisTurn =
          includeCtx && shouldIncludeContext(text, isFirstTurn);
        const fileContext = includeFileThisTurn ? text : undefined;

        // Try to detect language for the system prompt
        let language: string | undefined;
        try {
          language = await getLanguage();
        } catch {
          // leave undefined -> defaults to plaintext
        }

        setStreamingActive(panel, true);

        const promptContext: PromptContext = {
          code: userMessage,
          mode: 'chat',
          fileContext,
          language
        };
        const built =
          apiType === 'ollama'
            ? buildOllamaMessages(promptContext)
            : buildOpenAIMessages(promptContext);

        const newSystem = built[0];

        // Count tokens before mutating the conversation
        const beforeTokens = countMessageTokens(conversation);

        // Ensure a single, sticky system prompt
        if (isFirstTurn) {
          conversation.push(newSystem);
        } else if (conversation[0]?.role !== 'system') {
          conversation.unshift(newSystem);
        } else if (includeFileThisTurn) {
          conversation[0] = newSystem;
        }

        // Append current user turn
        conversation.push({ role: 'user', content: userMessage });

        // Calculate raw delta
        const afterTokens = countMessageTokens(conversation);
        let userTurnTokens = Math.max(0, afterTokens - beforeTokens);

        // Subtract file‐context tokens on the first turn
        if (isFirstTurn && includeFileThisTurn) {
          const ctxTokens = getFileContextTokens();
          userTurnTokens = Math.max(0, userTurnTokens - ctxTokens);
        }

        // Account for user tokens only
        addToSessionTokenCount(userTurnTokens);

        // Budget warning
        const total = countMessageTokens(conversation);
        const contextSize = getMaxContextTokens();
        if (total > contextSize) {
          vscode.window.showWarningMessage(
            `Your conversation uses ${total} tokens, exceeding your limit of ${contextSize}.`
          );
        }

        // Render user bubble
        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage,
          tokens: userTurnTokens
        });
        refreshTokenStats(panel);

        // Prepare streaming
        const controller = new AbortController();
        abortControllers.set(panel, controller);

        // Accumulator for the assistant’s full bubble
        let assistantText = '';

        try {
          await routeChatRequest({
            model,
            messages: conversation,
            signal: controller.signal,
            panel,
            onToken: (chunk: string) => {
              if (!isStreamingActive(panel)) return;
              assistantText += chunk;
              const chunkTokens = countTextTokens(chunk);
              addToSessionTokenCount(chunkTokens);
              refreshTokenStats(panel);
            },
            onDone: () => {
              // Optional: verify context presence
            }
          });

          setStreamingActive(panel, false);
        } catch (err: any) {
          setStreamingActive(panel, false);
          throw err;
        }

        break;
      }


      case 'stopGeneration': {
        setStreamingActive(panel, false);
        const controller = abortControllers.get(panel);
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
        panel.webview.postMessage({ type: 'stoppedStream', message: '' });
        break;
      }

      case 'openSettings': {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:officedrone.local-ai-assistant'
        );
        break;
      }

      case 'newSession': {
        resetSessionTokenCount();
        conversation = [];
        lastFileContextTokens = 0;
        chatPanel?.dispose();
        chatPanel = undefined;
        chatPanel = getOrCreateChatPanel();
        lastFileContextTokens = getEffectiveFileContextTokens();
        refreshTokenStats(chatPanel);
        break;
      }



      case 'insertCode': {
        if (evt.message) {
          await vscode.commands.executeCommand(
            'workbench.action.focusFirstEditorGroup'
          );
          const ed = vscode.window.activeTextEditor;
          if (!ed) {
            vscode.window.showWarningMessage('No active editor.');
            return;
          }
          const sel = ed.selection;
          const targetIndent =
            ed.document
              .lineAt(sel.active.line)
              .text.match(/^\s*/)?.[0] ?? '';

          const raw = String(evt.message).replace(/\r\n/g, '\n');
          const lines = raw.split('\n');

          // Find min common indent across non-empty lines of snippet
          const nonEmpty = lines.filter((l) => l.trim().length > 0);
          const minIndentLen = nonEmpty.length
            ? Math.min(
                ...nonEmpty.map((l) => (l.match(/^[ \t]*/)?.[0].length) ?? 0)
              )
            : 0;

          const reindented = lines
            .map((l) => {
              if (l.trim().length === 0) return '';
              // Remove only that min common indent, preserve deeper nesting
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
        break;
      }


      // Update context checkbox if changed outside of view
      case 'requestIncludeFileContext': {
        const value = getConfig<boolean>('context.includeFileContext', true);
        panel.webview.postMessage({
          type: 'includeFileContext',
          value
        });
        break;
      }

      case 'invokeCommand': {
        if (evt.command) {
          vscode.commands.executeCommand(evt.command);
        }
        break;
      }
    }
  });

  return chatPanel;
}

// Sends both `tokens` and `contextSize` to the webview so it can render
// "Current file in context X of Y".
function postFileContextTokens(panel: vscode.WebviewPanel): void {
  const effectiveTokens = getEffectiveFileContextTokens();
  const contextSize = getMaxContextTokens();

  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens: effectiveTokens,
    contextSize
  });

  refreshTokenStats(panel);
}




