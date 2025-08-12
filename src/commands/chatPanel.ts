// src/commands/chatPanel.ts

import * as vscode from 'vscode';
import { buildChatMessages } from './promptBuilder';
import { getWebviewContent } from '../static/chatPanelView';
import { fetchAvailableModels } from '../api/openaiProxy';
import encodingForModel from 'gpt-tokenizer';
import {
  countMessageTokens,
  countTextTokens,
  getFileContextTokens,
  addToSessionTokenCount,
  getSessionTokenCount,
  resetSessionTokenCount,
  getChatTokenCount
} from './tokenActions';


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

/**
 * Called on extension activation. Registers the `openChatPanel` command and wires up VSCode events
 * so file‐context token count is continuously pushed.
 */
export function registerChatPanelCommand(context: vscode.ExtensionContext) {
  extensionContext = context;

  // When a text document changes, recalc & push tokens
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      if (chatPanel) {
        postFileContextTokens(chatPanel);
      }
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
export function postSessionTokenUpdate(panel: vscode.WebviewPanel, sessionTokens: number, fileContextTokens: number) {
  panel.webview.postMessage({
    type: 'sessionTokenUpdate',
    sessionTokens,
    fileContextTokens,
    totalTokens: sessionTokens + fileContextTokens,
  });
}

export function getOrCreateChatPanel(): vscode.WebviewPanel {
  if (chatPanel) {
    chatPanel.reveal(vscode.ViewColumn.Two);
    postFileContextTokens(chatPanel);
    postSessionTokenUpdate(chatPanel, getSessionTokenCount(), lastFileContextTokens);



    return chatPanel;
  }

  conversation = [];

  // Split the editor 2:1
  vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{ size: 2 }, { size: 1 }],
  });

  chatPanel = vscode.window.createWebviewPanel(
    'LocalAIAssistantChat',
    'Local AI Assistant Chat',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  chatPanel.onDidDispose(() => (chatPanel = undefined));
  chatPanel.webview.html = getWebviewContent(extensionContext, chatPanel);

  // Immediately send the initial file‐context count
  postFileContextTokens(chatPanel);

  // Handle messages from the webview
  chatPanel.webview.onDidReceiveMessage(async (evt) => {
    const panel = chatPanel!;
    switch (evt.type) {
      case 'toggleIncludeFileContext':
        if (typeof evt.value === 'boolean') {
          await vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .update('context.includeFileContext', evt.value, vscode.ConfigurationTarget.Global);
          postFileContextTokens(panel);
        }
        return;

      case 'sendToAI': {
        const userMessage = evt.message?.trim();
        if (!userMessage) {
          return;
        }

        // optionally grab the current file's text
        const includeCtx = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<boolean>('includeFileContext', true);

        let fileContext: string | undefined;
        if (includeCtx) {
          const editor = getCodeEditor();
          if (editor && editor.document.uri.scheme !== 'vscode-webview') {
            fileContext = editor.document.getText();
          }
        }

        const model = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model') || '';

        const userTokens = countTextTokens(userMessage);
        addToSessionTokenCount(userTokens);

        // build chat messages and append to conversation history (system prompt only in first message)
        if (conversation.length === 0) {
          conversation.push(
            ...buildChatMessages({
              code: userMessage,
              mode: 'chat',
              fileContext,
            })
          );
        } else {
          conversation.push({ role: 'user', content: userMessage });
        }

        // check total token budget
        const total = countMessageTokens(conversation);
        const maxTokens = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<number>('maxTokens', 4096);

        if (total > maxTokens) {
          vscode.window.showWarningMessage(
            `Your conversation uses ${total} tokens, which is above your context (${maxTokens}).`
          );
        }

        // render the user bubble
        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage,
          tokens: userTokens,
        });

        postSessionTokenUpdate(panel, getSessionTokenCount(), lastFileContextTokens);

        // stream the assistant response
        await handleAiRequest(conversation, model, panel);

        // Push content count for context after response
        postSessionTokenUpdate(panel, getSessionTokenCount(), lastFileContextTokens);
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
        conversation = [];                // clear in-memory history
        lastFileContextTokens = 0;        // reset file context count if desired

        chatPanel?.dispose();
        chatPanel = undefined;            // force fresh creation

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
          await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
          const ed = vscode.window.activeTextEditor;
          if (!ed) {
            vscode.window.showWarningMessage('No active editor.');
            return;
          }

          const sel = ed.selection;
          const lineText = ed.document.lineAt(sel.active.line).text;
          const leadingWhitespace = lineText.match(/^\s*/)?.[0] ?? '';

          const indented = evt.message
            .split('\n')
            .map((line: string) => leadingWhitespace + line.trimStart())
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
          const value = vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<boolean>('context.includeFileContext', true);

          panel.webview.postMessage({
            type: 'includeFileContext',
            value,
          });
          break;
        }

    }
  });

  return chatPanel;
}


//Sends both `tokens` and `maxTokens` to the webview so it can render "Current file in context X of Y".
function postFileContextTokens(panel: vscode.WebviewPanel) {
  const editor = getCodeEditor();  
  const tokens = editor
    ? countTextTokens(editor.document.getText())
    : 0;
  lastFileContextTokens = tokens;
  const maxTokens = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxTokens', 4096);

  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens,
    maxTokens,
  });
  postSessionTokenUpdate(panel, getSessionTokenCount(), lastFileContextTokens);
}



 //Streams a chat completion, relays start/stream/end events back to the webview.
 export async function handleAiRequest(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  model: string,
  panel: vscode.WebviewPanel
) {
  const controller = new AbortController();
  abortControllers.set(panel, controller);

  panel.webview.postMessage({ type: 'startStream', message: '' });

  const endpoint = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('endpoint')!;

  try {
    const resp = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages }),
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let assistantText = '';

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        const chunk = decoder.decode(value);
        for (const part of chunk.split(/\n\n/)) {
          const m = part.match(/^data:\s*(.*)$/);
          if (m && m[1] !== '[DONE]') {
            try {
              const parsed = JSON.parse(m[1]);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              assistantText += delta;
              const deltaTokens = countTextTokens(delta);
              addToSessionTokenCount(deltaTokens);

              // Push streaming token update
              postSessionTokenUpdate(panel, getSessionTokenCount(), lastFileContextTokens);
              panel.webview.postMessage({
                type: 'streamChunk',
                message: delta,
              });
            } catch {
            }
          }
        }
      }
    }

    panel.webview.postMessage({ type: 'endStream', message: '' });

    const assistantTokens = encodingForModel.encode(assistantText).length;

    panel.webview.postMessage({
      type: 'finalizeAI',
      tokens: assistantTokens,
    });
    postSessionTokenUpdate(panel, getSessionTokenCount(), lastFileContextTokens);


    messages.push({ role: 'assistant', content: assistantText });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }
    console.error('AI request error:', err);

    let errMsg: string;
    try {
      const models = await fetchAvailableModels();
      errMsg = models.length
        ? '🚦 LLM service is reachable but no model seems to be loaded.'
        : '🔌 LLM service may be offline or misconfigured.';
    } catch {
      errMsg = '🔌 LLM service may be offline or misconfigured.';
    }

    vscode.window
      .showErrorMessage(errMsg, 'Open Settings')
      .then((sel) => {
        if (sel === 'Open Settings') {
          vscode.commands.executeCommand('extension.openChatPanel');
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:officedrone.local-ai-assistant'
          );
        }
      });
  }
}
