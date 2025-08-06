// src/commands/chatPanel.ts

import * as vscode from 'vscode';
import { buildChatMessages } from './promptBuilder';
import { getWebviewContent } from '../static/chatPanelView';
import { fetchAvailableModels } from '../api/openaiProxy';
import encodingForModel from 'gpt-tokenizer';

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
let extensionContext: vscode.ExtensionContext;

// tracks the history of messages
let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

/**
 * Called on extension activation.  
 * Registers the `openChatPanel` command and wires up VSCode events
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
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (chatPanel) {
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

export function getOrCreateChatPanel(): vscode.WebviewPanel {
  if (chatPanel) {
    chatPanel.reveal(vscode.ViewColumn.Two);
    postFileContextTokens(chatPanel);
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
            .update('includeFileContext', evt.value, vscode.ConfigurationTarget.Global);
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
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.uri.scheme !== 'vscode-webview') {
            fileContext = editor.document.getText();
          }
        }

        const model = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model') || '';

        const userTokens = encodingForModel.encode(userMessage).length;

        // build chat messages and append to conversation history
        conversation.push(
          ...buildChatMessages({
            code: userMessage,
            mode: 'chat',
            fileContext,
          })
        );

        // check total token budget
        const total = countTokens(conversation);
        const maxTokens = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<number>('maxTokens', 4096);

        if (total > maxTokens) {
          vscode.window.showWarningMessage(
            `⚠️ Your conversation uses ${total} tokens, but the limit is ${maxTokens}.`
          );
          return;
        }

        // render the user bubble
        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage,
          tokens: userTokens,
        });

        // update file‐context count in the UI
        postFileContextTokens(panel);

        // stream the assistant response
        await handleAiRequest(conversation, model, panel);
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
        panel.dispose();
        chatPanel = undefined;
        getOrCreateChatPanel();
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
          await ed.edit((edit) => {
            if (!sel.isEmpty) {
              edit.replace(sel, evt.message!);
            } else {
              const line = ed.document.lineAt(sel.active.line);
              edit.replace(line.range, evt.message!);
            }
          });
        }
        break;
    }
  });

  return chatPanel;
}

/**
 * Count tokens in a conversation array.
 */
function countTokens(messages: { role: string; content: string }[]): number {
  let total = 0;
  for (const m of messages) {
    total += encodingForModel.encode(m.content).length;
    total += 4; // metadata padding
  }
  return total;
}

/**
 * Sends both `tokens` and `maxTokens` to the webview
 * so it can render "Current file in context X of Y".
 */
function postFileContextTokens(panel: vscode.WebviewPanel) {
  const tokens = getFileContextTokens();
  const maxTokens = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxTokens', 4096);

  panel.webview.postMessage({
    type: 'fileContextTokens',
    tokens,
    maxTokens,
  });
}

/**
 * Returns the token count of the active file, or 0 if disabled/no file.
 */
function getFileContextTokens(): number {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('includeFileContext', true);
  if (!includeCtx) {
    return 0;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme === 'vscode-webview') {
    return 0;
  }
  return encodingForModel.encode(editor.document.getText()).length;
}

/**
 * Streams a chat completion from your endpoint, relaying start/stream/end
 * events back to the webview.
 */
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
              panel.webview.postMessage({
                type: 'streamChunk',
                message: delta,
              });
            } catch {
              // ignore
            }
          }
        }
      }
    }

    panel.webview.postMessage({ type: 'endStream', message: '' });
    panel.webview.postMessage({
      type: 'finalizeAI',
      tokens: encodingForModel.encode(assistantText).length,
    });

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
        ? '🚦 LLM is reachable but no model loaded. Select or load one.'
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
