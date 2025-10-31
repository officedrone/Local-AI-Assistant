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
  let startTime = Date.now();
  let totalTokens = 0;

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

    const finalTokens = encodingForModel.encode(assistantText).length;

    // Calculate TPS
    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;
    const tps = durationSeconds > 0 ? (finalTokens / durationSeconds).toFixed(1) : '0.0';

    // Send the one-and-only finalizeAI token count with TPS
    panel.webview.postMessage({
      type: 'finalizeAI',
      tokens: finalTokens,
      tps: parseFloat(tps)
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

          // NEW: Send real-time token count during streaming
          if (onToken) onToken(chunk);

          // Track tokens and time for TPS calculation
          totalTokens = encodingForModel.encode(assistantText).length;
          const elapsedSeconds = (Date.now() - startTime) / 1000;

          // Calculate TPS based on current progress, but smooth it out
          let tps = 0;
          if (elapsedSeconds > 0) {
            // Use a more stable calculation that doesn't jump around so much
            tps = totalTokens / elapsedSeconds;
            // Cap at reasonable values to prevent extreme jumps
            tps = Math.min(tps, 1000); // Cap at 1000 TPS for sanity
          }

          // Send intermediate token count for this chunk with TPS
          panel.webview.postMessage({
            type: 'streamTokenUpdate',
            tokens: totalTokens,
            tps: parseFloat(tps.toFixed(1))
          });
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

            // NEW: Send real-time token count during streaming
            if (onToken) onToken(chunk);

            // Track tokens and time for TPS calculation
            totalTokens = encodingForModel.encode(assistantText).length;
            const elapsedSeconds = (Date.now() - startTime) / 1000;

            // Calculate TPS based on current progress, but smooth it out
            let tps = 0;
            if (elapsedSeconds > 0) {
              // Use a more stable calculation that doesn't jump around so much
              tps = totalTokens / elapsedSeconds;
              // Cap at reasonable values to prevent extreme jumps
              tps = Math.min(tps, 1000); // Cap at 1000 TPS for sanity
            }

            // Send intermediate token count for this chunk with TPS
            panel.webview.postMessage({
              type: 'streamTokenUpdate',
              tokens: totalTokens,
              tps: parseFloat(tps.toFixed(1))
            });
          },
          onDone: finalize,
        });



      } catch (streamErr) {
        console.warn(
          '⚠️ OpenAI streaming failed, falling back to non‐streaming:',
          streamErr
        );

        //Bail out if Stop was pressed before fallback starts
        if (!isStreamingActive(panel) || signal?.aborted) {
          panel.webview.postMessage({ type: 'stoppedStream', message: '' });
          return;
        }

        const response = await sendToOpenAI({ model, messages, signal });

        //Bail out if Stop was pressed during fallback request
        if (!isStreamingActive(panel) || signal?.aborted) {
          panel.webview.postMessage({ type: 'stoppedStream', message: '' });
          return;
        }

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
