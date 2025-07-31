// src/commands/chatPanel.ts

import * as vscode from 'vscode';
import { buildChatMessages } from './promptBuilder';
import { getWebviewContent } from '../static/chatPanelView';
import { fetchAvailableModels } from '../api/openaiProxy';

const CONFIG_SECTION = 'localAIAssistant';

let chatPanel: vscode.WebviewPanel | undefined;
const abortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
let extensionContext: vscode.ExtensionContext;

// Maintains the full back-and-forth
let conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

/**
 * Register the “Open Chat Panel” command.
 */
export function registerChatPanelCommand(context: vscode.ExtensionContext) {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.openChatPanel', () => {
      if (chatPanel) {
        chatPanel.reveal(vscode.ViewColumn.Two);
      } else {
        getOrCreateChatPanel();
      }
    })
  );
}

/**
 * Create or reveal the chat webview.
 * Clears `conversation` on a brand-new panel.
 */
export function getOrCreateChatPanel(): vscode.WebviewPanel {
  if (chatPanel) {
    chatPanel.reveal(vscode.ViewColumn.Two);
    return chatPanel;
  }

  // reset history
  conversation = [];

  vscode.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{ size: 3 }, { size: 1 }],
  });

  chatPanel = vscode.window.createWebviewPanel(
    'LocalAIAssistantChat',
    'Local AI Assistant Chat',
    vscode.ViewColumn.Two,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  chatPanel.onDidDispose(() => (chatPanel = undefined));
  chatPanel.webview.html = getWebviewContent(extensionContext, chatPanel);

  chatPanel.webview.onDidReceiveMessage(async (evt) => {
    const panel = chatPanel!;

    // handle the include-file-context toggle
    if (evt.type === 'toggleIncludeFileContext' && typeof evt.value === 'boolean') {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update('includeFileContext', evt.value, vscode.ConfigurationTarget.Global);
      return;
    }

    switch (evt.type) {
      case 'sendToAI': {
        const userMessage = evt.message?.trim();
        if (!userMessage) {
          return;
        }

        // determine if we should include the file context
        const includeCtx = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<boolean>('includeFileContext', true);

        let fileContext: string | undefined;
        if (includeCtx) {
          // pick the first non‐webview visible editor
          const codeEditor = vscode.window.visibleTextEditors.find(
            (ed) => ed.document.uri.scheme !== 'vscode-webview'
          );
          if (codeEditor) {
            fileContext = codeEditor.document.getText();
          }
        }

        // choose LLM model
        const model =
          vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('model') ||
          '';

        // build system + context + user turn
        conversation.push(
          ...buildChatMessages({
            code: userMessage,
            mode: 'chat',
            fileContext,
          })
        );

        panel.webview.postMessage({ type: 'appendUser', message: userMessage });

        // stream assistant reply and append to conversation
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
 * Stream the LLM response and then append to `conversation`.
 * On error, run a two-step health check against `/models`.
 */
export async function handleAiRequest(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  model: string,
  panel: vscode.WebviewPanel
) {
  const controller = new AbortController();
  abortControllers.set(panel, controller);

  panel.webview.postMessage({ type: 'startStream', message: '' });

  const endpoint = vscode
    .workspace.getConfiguration(CONFIG_SECTION)
    .get<string>('endpoint')!;

  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let assistantText = '';

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;

      if (value) {
        const chunk = decoder.decode(value);
        for (const part of chunk.split(/\n\n/)) {
          const m = part.match(/^data: (.*)$/);
          if (m && m[1] !== '[DONE]') {
            try {
              const parsed = JSON.parse(m[1]);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              assistantText += delta;
              panel.webview.postMessage({ type: 'streamChunk', message: delta });
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    }

    panel.webview.postMessage({ type: 'endStream', message: '' });
    messages.push({ role: 'assistant', content: assistantText });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }

    console.error('AI error:', err);

    // two-step health check
    let userMsg: string;
    try {
      const models = await fetchAvailableModels();
      userMsg =
        models.length > 0
          ? '🚦 LLM service is reachable, but no model is currently loaded. Contact the admin to load up an LLM, or use CTRL+SHIFT+ALT+M to select a model if the service supports JIT model loading.'
          : '🔌 LLM service may be offline or misconfigured. Check your endpoint and authentication.';
    } catch {
      userMsg = '🔌 LLM service may be offline or misconfigured. Check your endpoint and authentication.';
    }

    vscode.window
      .showErrorMessage(userMsg, 'Open Settings')
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
