import * as vscode from 'vscode';
import { sendToOpenAI, streamFromOpenAI } from './openaiProxy';
import { streamFromOllama } from './ollamaProxy';
import encodingForModel from 'gpt-tokenizer';
import {
  addToSessionTokenCount,
  getSessionTokenCount
} from '../commands/tokenActions';

type AnyMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OllamaMessage = {
  role: 'system' | 'user';
  content: string;
};

function filterOllamaMessages(messages: AnyMessage[]): OllamaMessage[] {
  return messages.filter((m): m is OllamaMessage => m.role !== 'assistant');
}

export async function handleStreamingResponse({
  model,
  messages,
  signal,
  panel,
  apiType,
}: {
  model: string;
  messages: AnyMessage[];
  signal?: AbortSignal;
  panel: vscode.WebviewPanel;
  apiType: string;
}): Promise<void> {
  panel.webview.postMessage({ type: 'startStream', message: '' });

  try {
    let assistantText = '';

    const finalize = () => {
      const assistantTokens = encodingForModel.encode(assistantText).length;
      addToSessionTokenCount(assistantTokens);

      panel.webview.postMessage({ type: 'finalizeAI', tokens: assistantTokens });
      panel.webview.postMessage({ type: 'endStream', message: '' });
      panel.webview.postMessage({
        type: 'sessionTokenUpdate',
        sessionTokens: getSessionTokenCount(),
        fileContextTokens: 0,
        totalTokens: getSessionTokenCount(),
      });

      messages.push({ role: 'assistant', content: assistantText });
    };

    if (apiType === 'ollama') {
      const ollamaMessages = filterOllamaMessages(messages);

      await streamFromOllama({
        model,
        messages: ollamaMessages,
        signal,
        onToken: (token) => {
          assistantText += token;
          panel.webview.postMessage({ type: 'streamChunk', message: token });
        },
        onDone: finalize
      });
    } else {
      try {
        await streamFromOpenAI({
          model,
          messages,
          signal,
          onToken: (token) => {
            assistantText += token;
            panel.webview.postMessage({ type: 'streamChunk', message: token });
          },
          onDone: finalize
        });
      } catch (streamErr) {
        console.warn('⚠️ OpenAI streaming failed, falling back to non-streaming:', streamErr);

        const response = await sendToOpenAI({ model, messages, signal });

        if (response.startsWith('Error:')) {
          panel.webview.postMessage({ type: 'endStream', message: '' });
          return;
        }

        assistantText = response;
        finalize();
        panel.webview.postMessage({ type: 'streamChunk', message: assistantText });
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }

    console.error('Streaming error:', err);
    panel.webview.postMessage({ type: 'endStream', message: '' });

    await vscode.window
      .showErrorMessage('🔌 LLM service may be offline or misconfigured.', 'Open Settings')
      .then((sel) => {
        if (sel === 'Open Settings') {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:officedrone.local-ai-assistant'
          );
        }
      });
  }
}
