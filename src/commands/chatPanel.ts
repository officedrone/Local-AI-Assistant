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
  resetSessionTokenCount
} from './tokenActions';
import { routeChatRequest } from '../api/apiRouter';

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
let extensionContext: vscode.ExtensionContext;
let lastFileContextTokens = 0;

// tracks the history of messages
let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

//Code editor definition for context purposes
function getCodeEditor(): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (ed) => ed.document.uri.scheme !== 'vscode-webview'
  );
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
    vscode.window.onDidChangeActiveTextEditor(editor => {
    // only fire when there's a normal text editor in focus
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
//SessionTokenUpdate function

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
      lastFileContextTokens
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
      case 'toggleIncludeFileContext':
        if (typeof evt.value === 'boolean') {
          await config.update(
            'context.includeFileContext',
            evt.value,
            vscode.ConfigurationTarget.Global
          );
          postFileContextTokens(panel);
        }
        return;

      case 'sendToAI': {
        const userMessage = evt.message?.trim();
        if (!userMessage) return;

        const includeCtx = config.get<boolean>(
          'includeFileContext',
          true
        );
        const apiType = config.get<string>('apiType', 'openai');
        const model = config.get<string>('model') || '';

        let fileContext: string | undefined;
        if (includeCtx) {
          const ed = getCodeEditor();
          if (ed) fileContext = ed.document.getText();
        }

        // 1) Count user tokens
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
          lastFileContextTokens
        );

        //Prepare streaming
        const controller = new AbortController();
        abortControllers.set(panel, controller);

        // Accumulator for the assistant’s full bubble
        let assistantText = '';

        await routeChatRequest({
          model,
          messages: conversation,
          signal: controller.signal,
          panel,
          onToken: (chunk: string) => {
            // accumulate
            assistantText += chunk;

            // count this chunk
            const chunkTokens = countTextTokens(chunk);

            // stream to view
            panel.webview.postMessage({
              type: 'appendAssistant',
              message: chunk,
              tokens: chunkTokens,
              isStream: true
            });

            // update session total
            addToSessionTokenCount(chunkTokens);
            postSessionTokenUpdate(
              panel,
              getSessionTokenCount(),
              lastFileContextTokens
            );
          },
          onDone: () => {
            // final token count on the full assistant bubble
            const aiTokens = countTextTokens(assistantText);

            // notify the view to render the bubble’s total token count
            panel.webview.postMessage({
              type: 'finalizeAI',
              tokens: aiTokens
            });

            // and sync overall counts one last time
            postSessionTokenUpdate(
              panel,
              getSessionTokenCount(),
              lastFileContextTokens
            );
          }
        });

        break;
      }

      case 'stopGeneration':
        abortControllers.get(panel)?.abort();
        break;

      case 'openSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:officedrone.local-ai-assistant'
        );
        break;

      case 'newSession':
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
          lastFileContextTokens
        );
        break;

      case 'insertCode':
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
          const lineText = ed.document.lineAt(sel.active.line).text;
          const indent = lineText.match(/^\s*/)?.[0] ?? '';
          const indented = (evt.message as string)
            .split('\n')
            .map((line: string) => indent + line.trimStart())
            .join('\n');
          await ed.edit((edit) => {
            if (!sel.isEmpty) {
              edit.replace(sel, indented);
            } else {
              const line = ed.document.lineAt(sel.active.line);
              edit.replace(line.range, indented);
            }
          });
        }
        break;
        //Update context checkbox if changed outside of view
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


//Sends both `tokens` and `maxTokens` to the webview so it can render "Current file in context X of Y".
function postFileContextTokens(panel: vscode.WebviewPanel) {
  lastFileContextTokens = getFileContextTokens();
  const maxTokens = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxTokens', 4096);

  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens: lastFileContextTokens,
    maxTokens
  });

  postSessionTokenUpdate(
    panel,
    getSessionTokenCount(),
    lastFileContextTokens
  );
}
