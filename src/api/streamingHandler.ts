// src/api/streamingHandler.ts

import * as vscode from 'vscode';
import { sendToOpenAI, streamFromOpenAI } from './openaiProxy';
import { streamFromOllama } from './ollamaProxy';
import encodingForModel from 'gpt-tokenizer';
import { isStreamingActive, setStreamingActive } from '../commands/tokenActions';

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
  const requestId = Date.now();
  
  // Track how many chunks we actually send to the webview
  let chunksSentToWebview = 0;
  
  console.log(`[handleStreamingResponse] Starting request ${requestId}, model=${model}, messages=${messages.length}`);
  
  panel.webview.postMessage({ type: 'startStream', message: '' });

  let assistantText = '';
  let startTime = Date.now();
  let totalTokens = 0;

  // Guard so finalize() can only run one time
  let didFinalize = false;
  let streamCompleted = false; // Track if we've received [DONE] from the API
  
  const finalize = async () => {
    if (didFinalize) return;
    didFinalize = true;
    
    // Mark that streaming has completed - new chunks after this are late
    streamCompleted = true;

    console.log(`[finalize] Called, assistantText length=${assistantText.length}, isStreamingActive=${isStreamingActive(panel)}, chunksSentToWebview=${chunksSentToWebview}`);
    
    // Debug: Log the last few messages to understand what triggered this
    const lastMsg = messages[messages.length - 1];
    console.log(`[finalize] Last message role: ${lastMsg?.role}, content length: ${lastMsg?.content?.length ?? 0}`);
    
    // Check if assistant text contains a tool call
    const hasToolCall = assistantText.includes('<tool>');
    console.log(`[finalize] Assistant text contains tool call: ${hasToolCall}`);

    // If the stream was stopped, don't finalize UI tokens or append to history
    if (!isStreamingActive(panel)) {
      console.log(`[finalize] Stream already stopped (isStreamingActive=false), skipping finalization`);
      panel.webview.postMessage({ type: 'stoppedStream', message: '' });
      return;
    }

    // DON'T clear streaming flag yet - wait until after endStream is sent
    // This prevents race condition where late chunks get dropped
    console.log(`[finalize] Streaming flag still active, proceeding with finalization`);

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

    // Close out the stream - but only if we haven't already started a continuation
    console.log(`[finalize] Checking stream state before sending endStream...`);
    
    // Wait to ensure all chunk messages are processed in webview queue
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Check if streaming is still marked as active (might have been cleared by continuation)
    const streamStillActive = isStreamingActive(panel);
    console.log(`[finalize] After delay: isStreamingActive=${streamStillActive}, chunksSentToWebview=${chunksSentToWebview}`);
    
    if (streamStillActive || chunksSentToWebview === 0) {
      // Either still active (continuation started) or no chunks were sent - skip endStream
      console.log(`[finalize] Skipping endStream: streamStillActive=${streamStillActive}, noChunks=${chunksSentToWebview === 0}`);
    } else {
      console.log(`[finalize] Sending endStream after ${chunksSentToWebview} chunks`);
      panel.webview.postMessage({ type: 'endStream', message: '' });
      console.log(`[finalize] endStream sent successfully`);
      
      // NOW clear the streaming flag AFTER endStream is sent
      console.log(`[finalize] Clearing streaming flag after endStream`);
      setStreamingActive(panel, false);
    }

    console.log(`[finalize] Stream completed successfully, assistantText length=${assistantText.length}`);

    // Add to conversation history BEFORE calling onDone so continuation can see it
    messages.push({ role: 'assistant', content: assistantText });
    
    console.log(`[finalize] Added assistant message to conversation`);

    if (onDone) {
      console.log(`[finalize] Calling onDone callback`);
      onDone();
    }
  };


  try {
    if (apiType === 'ollama') {
      const ollamaMessages = filterOllamaMessages(messages);
      await streamFromOllama({
        model,
        messages: ollamaMessages,
        signal,
          onToken: (chunk: string) => {
            console.log(`[streamFromOllama] Chunk arrived, isStreamingActive=${isStreamingActive(panel)}, signalAborted=${signal?.aborted}, assistantTextLength=${assistantText.length}`);
            
            // Only drop chunks if explicitly aborted OR stream has already completed
            // This prevents dropping chunks that arrive during the brief window between [DONE] and finalize()
            if (signal?.aborted) {
              console.log(`[streamFromOllama] Dropping chunk because signal was aborted`);
              return;
            }
            
            if (streamCompleted) {
              console.log(`[streamFromOllama] Dropping late chunk - stream already completed`);
              return;
            }

          console.log(`[streamFromOllama] Received chunk, length=${chunk.length}, assistantText now ${assistantText.length} chars`);
          
          // Debug: Log first few chunks to verify content
          if (chunksSentToWebview <= 3) {
            console.log(`[streamFromOllama] First chunk #${chunksSentToWebview}: "${chunk.substring(0, 100)}"`);
          }

            assistantText += chunk;
            
            chunksSentToWebview++;
            console.log(`[streamFromOllama] Sending streamChunk to webview (chunk #${chunksSentToWebview}), length=${chunk.length}`);
            // IMPORTANT: Send raw chunk WITHOUT stripping thinking/tool tags
            // The webview will handle tag detection and bubble creation
            try {
              const msg = { type: 'streamChunk', message: chunk };
              panel.webview.postMessage(msg);
              console.log(`[streamFromOllama] postMessage sent successfully for chunk #${chunksSentToWebview}`);
            } catch (err) {
            console.error(`[streamFromOllama] postMessage failed:`, err);
            
            // CRITICAL: If postMessage fails, don't count this as a successful chunk
            chunksSentToWebview--;
          }

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
            console.log(`[streamFromOpenAI] Chunk arrived, isStreamingActive=${isStreamingActive(panel)}, signalAborted=${signal?.aborted}, assistantTextLength=${assistantText.length}`);
            
            // Only drop chunks if explicitly aborted OR stream has already completed
            // This prevents dropping chunks that arrive during the brief window between [DONE] and finalize()
            if (signal?.aborted) {
              console.log(`[streamFromOpenAI] Dropping chunk because signal was aborted`);
              return;
            }
            
            if (streamCompleted) {
              console.log(`[streamFromOpenAI] Dropping late chunk - stream already completed`);
              return;
            }

            console.log(`[streamFromOpenAI] Received chunk, length=${chunk.length}, assistantText now ${assistantText.length} chars`);
            
            // Debug: Log first few chunks to verify content
            if (chunksSentToWebview <= 3) {
              console.log(`[streamFromOpenAI] First chunk #${chunksSentToWebview}: "${chunk.substring(0, 100)}"`);
            }

            assistantText += chunk;
            
            chunksSentToWebview++;
            console.log(`[streamFromOpenAI] Sending streamChunk to webview (chunk #${chunksSentToWebview}), length=${chunk.length}`);
            // IMPORTANT: Send raw chunk WITHOUT stripping thinking/tool tags
            // The webview will handle tag detection and bubble creation
            try {
              const msg = { type: 'streamChunk', message: chunk };
              panel.webview.postMessage(msg);
              console.log(`[streamFromOpenAI] postMessage sent successfully for chunk #${chunksSentToWebview}`);
            } catch (err) {
              console.error(`[streamFromOpenAI] postMessage failed:`, err);
              
              // CRITICAL: If postMessage fails, don't count this as a successful chunk
              chunksSentToWebview--;
            }

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
        
        // IMPORTANT: Send raw response WITHOUT stripping thinking/tool tags
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
