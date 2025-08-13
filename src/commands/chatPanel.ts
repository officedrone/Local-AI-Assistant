import * as vscode from 'vscode';
import {
  buildOpenAIMessages,
  buildOllamaMessages,
  PromptContext
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

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();

let extensionContext: vscode.ExtensionContext;
let lastFileContextTokens = 0;

// tracks the history of messages
let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

// Code editor definition for context purposes (works even when webview has focus)
function getCodeEditor(): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (ed) => ed.document.uri.scheme !== 'vscode-webview'
  );
}

export function getActiveChatPanel(): vscode.WebviewPanel | undefined {
  return chatPanel;
}

export function registerChatPanelCommand(context: vscode.ExtensionContext) {
  extensionContext = context;

  // When a text document changes, recalc & push tokens
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      if (chatPanel) postFileContextTokens(chatPanel);
    })
  );

  // When the user switches editors, recalc & push tokens
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (
        chatPanel &&
        editor &&
        editor.document.uri.scheme !== 'vscode-webview'
      ) {
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
) {
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
    postSessionTokenUpdate(
      chatPanel,
      getSessionTokenCount(),
      getEffectiveFileContextTokens()
    );
    return chatPanel;
  }

  conversation = [];

  // Split the editor 2:1
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

  chatPanel.onDidDispose(() => (chatPanel = undefined));
  chatPanel.webview.html = getWebviewContent(extensionContext, chatPanel);

  // Immediately send the initial file‐context count
  postFileContextTokens(chatPanel);

  // Handle messages from the webview
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
        if (!userMessage) return;

        const includeCtx = config.get<boolean>('includeFileContext', true);
        const apiType = config.get<string>('apiType', 'openai');
        const model = config.get<string>('model') || '';

        let fileContext: string | undefined;
        if (includeCtx) {
          const ed = getCodeEditor();
          if (ed) fileContext = ed.document.getText();
        }


        // Mark streaming active before any token adds
        setStreamingActive(panel, true);

        //Count user tokens
        const userTokens = countTextTokens(userMessage);
        addToSessionTokenCount(userTokens);

        // build chat messages and append to conversation history (system prompt only in first message)
        if (conversation.length === 0) {
          const promptContext: PromptContext = {
            code: userMessage,
            mode: 'chat',
            fileContext
          };
          const msgs =
            apiType === 'ollama'
              ? buildOllamaMessages(promptContext)
              : buildOpenAIMessages(promptContext);
          conversation.push(...msgs);
        } else {
          conversation.push({ role: 'user', content: userMessage });
        }

        // check total token budget
        const total = countMessageTokens(conversation);
        const maxTokens = config.get<number>('maxTokens', 4096);
        if (total > maxTokens) {
          vscode.window.showWarningMessage(
            `Your conversation uses ${total} tokens, exceeding your limit of ${maxTokens}.`
          );
        }

        // render the user bubble
        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage,
          tokens: userTokens
        });
        postSessionTokenUpdate(
          panel,
          getSessionTokenCount(),
          getEffectiveFileContextTokens()
        );

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
              // Central guard lives in tokenActions.addToSessionTokenCount as well,
              // but this early check avoids extra work here too.
              if (!isStreamingActive(panel)) return;

              // accumulate
              assistantText += chunk;

              // count this chunk
              const chunkTokens = countTextTokens(chunk);

              // update session total
              addToSessionTokenCount(chunkTokens);
              postSessionTokenUpdate(
                panel,
                getSessionTokenCount(),
                getEffectiveFileContextTokens()
              );
            }
          });

          // Stream completed normally
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
        lastFileContextTokens = getFileContextTokens();
        postSessionTokenUpdate(
          chatPanel,
          getSessionTokenCount(),
          getEffectiveFileContextTokens()
        );
        break;
      }

      case 'insertCode': {
        if (evt.message) {
          await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
          const ed = vscode.window.activeTextEditor;
          if (!ed) {
            vscode.window.showWarningMessage('No active editor.');
            return;
          }
          const sel = ed.selection;
          const targetIndent = ed.document.lineAt(sel.active.line).text.match(/^\s*/)?.[0] ?? '';

          const raw = String(evt.message).replace(/\r\n/g, '\n');
          const lines = raw.split('\n');

          // Find min common indent across non-empty lines of snippet
          const nonEmpty = lines.filter(l => l.trim().length > 0);
          const minIndentLen = nonEmpty.length
            ? Math.min(...nonEmpty.map(l => (l.match(/^[ \t]*/)?.[0].length) ?? 0))
            : 0;

          const reindented = lines
            .map(l => {
              if (l.trim().length === 0) return '';
              // Remove only that min common indent, preserve deeper nesting
              return targetIndent + l.slice(minIndentLen);
            })
            .join('\n');

          await ed.edit(edit => {
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
        const value = config.get<boolean>('context.includeFileContext', true);
        panel.webview.postMessage({
          type: 'includeFileContext',
          value
        });
        break;
      }
    }
  });

  return chatPanel;
}

// Sends both `tokens` and `maxTokens` to the webview so it can render "Current file in context X of Y".
function postFileContextTokens(panel: vscode.WebviewPanel) {
  // Always compute actual tokens from a real editor, even when webview focused
  const actualTokens = getFileContextTokens();
  const effectiveTokens = getEffectiveFileContextTokens();

  const maxTokens = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxTokens', 4096);

  // For checkbox label (always show actual tokens)
  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens: actualTokens,
    maxTokens
  });

  // For top bar stats (include only if checkbox checked)
  postSessionTokenUpdate(
    panel,
    getSessionTokenCount(),
    effectiveTokens
  );
}
