// src/api/streamingHandler.ts

import * as vscode from 'vscode';
import { sendToOpenAI, streamFromOpenAI } from './openaiProxy';
import { streamFromOllama } from './ollamaProxy';
import encodingForModel from 'gpt-tokenizer';
import { isStreamingActive } from '../commands/tokenActions';

export interface StreamingResponseOptions {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  panel: vscode.WebviewPanel;
  apiType: string;

  // callbacks for each chunk and stream completion
  onToken?: (chunk: string) => void;
  onDone?: () => void;
}

type AnyMessage = StreamingResponseOptions['messages'][number];
type OllamaMessage = { role: 'system' | 'user'; content: string };

function filterOllamaMessages(messages: AnyMessage[]): OllamaMessage[] {
  return messages.filter((m): m is OllamaMessage => m.role !== 'assistant');
}

export async function handleStreamingResponse({
  model,
  messages,
  signal,
  panel,
  apiType,
  onToken,
  onDone,
}: StreamingResponseOptions): Promise<void> {

  // Notify the webview we're starting a new stream
  panel.webview.postMessage({ type: 'startStream', message: '' });

  let assistantText = '';

  // Guard so finalize() can only run one time
  let didFinalize = false;
  const finalize = () => {
    if (didFinalize) return;
    didFinalize = true;

    // If the stream was stopped, don't finalize UI tokens or append to history
    if (!isStreamingActive(panel)) {
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }

    // Send the one-and-only finalizeAI token count
    panel.webview.postMessage({
      type: 'finalizeAI',
      tokens: encodingForModel.encode(assistantText).length
    });

    // Close out the stream
    panel.webview.postMessage({ type: 'endStream', message: '' });

    // Add to conversation history
    messages.push({ role: 'assistant', content: assistantText });

    // Notify upstream that streaming is done
    if (onDone) onDone();
  };

  try {
    if (apiType === 'ollama') {
      const ollamaMessages = filterOllamaMessages(messages);
      await streamFromOllama({
        model,
        messages: ollamaMessages,
        signal,
        onToken: (chunk: string) => {
          // Drop late chunks after Stop
          if (!isStreamingActive(panel) || signal?.aborted) return;

          assistantText += chunk;
          panel.webview.postMessage({ type: 'streamChunk', message: chunk });
          if (onToken) onToken(chunk);
        },
        onDone: finalize,
      });
    } else {
      try {
        await streamFromOpenAI({
          model,
          messages,
          signal,
          onToken: (chunk: string) => {
            // Drop late chunks after Stop
            if (!isStreamingActive(panel) || signal?.aborted) return;

            assistantText += chunk;
            panel.webview.postMessage({ type: 'streamChunk', message: chunk });
            if (onToken) onToken(chunk);
          },
          onDone: finalize,
        });
      } catch (streamErr) {
        console.warn(
          '⚠️ OpenAI streaming failed, falling back to non‐streaming:',
          streamErr
        );

        const response = await sendToOpenAI({ model, messages, signal });
        if (response.startsWith('Error:')) {
          panel.webview.postMessage({ type: 'endStream', message: '' });
          return;
        }

        // Fallback full response path
        assistantText = response;
        panel.webview.postMessage({ type: 'streamChunk', message: assistantText });
        finalize();
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // UI already guarded; just inform webview explicitly
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }

    console.error('Streaming error:', err);
    panel.webview.postMessage({ type: 'endStream', message: '' });

    await vscode.window
      .showErrorMessage(
        '🔌 LLM service may be offline or misconfigured.',
        'Open Settings'
      )
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
