// src/api/openaiProxy.ts
import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

export interface ChatRequestOptions {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

// Normalize endpoint to include /v1 if missing
function normalizeOpenAIEndpoint(endpoint: string): string {
  return endpoint.includes('/v1') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1`;
}

// Secure API key retrieval
async function getApiKey(): Promise<string | undefined> {
  return await vscode.extensions
    .getExtension('officedrone.local-ai-assistant')
    ?.exports?.getSecret?.('localAIAssistant.apiLLM.config.apiKey');
}

// ✅ Fetch available OpenAI models
export async function fetchOpenAiModels(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoint = config.get<string>('apiLLM.apiURL.endpoint');

  if (!endpoint) {
    vscode.window.showErrorMessage('❌ No endpoint configured.');
    return [];
  }

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);
  const apiKey = await getApiKey();

  try {
    const res = await fetch(`${normalizedEndpoint}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as { data?: { id: string }[] };
    return data.data?.map((m) => m.id).filter(Boolean) ?? [];
  } catch (err) {
    //vscode.window.showErrorMessage(`🛑 Failed to fetch OpenAI model list: ${err}`);
    console.error('OpenAI model list error:', err);
    return [];
  }
}

// ✅ Helper to ensure model is set or prompt user
async function ensureOpenAIModel(model?: string): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  let finalModel = model?.trim() || config.get<string>('apiLLM.config.model')?.trim();

  if (!finalModel) {
    const models = await fetchOpenAiModels();
    if (models.length === 0) {
      vscode.window.showErrorMessage(
        '🚫 No OpenAI-compatible models available. Load or configure models first by pressing CTRL+SHIFT+ALT+M (CMD+SHIFT+ALT+M on Mac).'
      );
      throw new Error('No models available');
    }

    const selected = await vscode.window.showQuickPick(models, {
      placeHolder: 'Select an OpenAI model to use',
    });

    if (!selected) {
      console.warn('[OpenAIProxy] aborted: user did not select a model');
      throw new Error('No model selected');
    }

    await config.update('apiLLM.config.model', selected, vscode.ConfigurationTarget.Global);
    finalModel = selected;
  }

  return finalModel;
}

// ✅ Streaming support
let debugDeltaLogged = false;
let inReasoningBlock = false;

export async function streamFromOpenAI({
  model,
  messages,
  signal,
  onToken,
  onDone,
}: {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onDone?: () => void;
}): Promise<void> {
  const requestId = Date.now();
  console.log(`[streamFromOpenAI] REQUEST ${requestId} STARTED, messages=${messages.length}, last msg role=${messages[messages.length-1]?.role}`);
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoint = config.get<string>('apiLLM.apiURL.endpoint');
  if (!endpoint) throw new Error('No endpoint configured');

  const finalModel = await ensureOpenAIModel(model);
  if (!finalModel) return;

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);
  const apiKey = await getApiKey();

  const res = await fetch(`${normalizedEndpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model: finalModel, messages, stream: true }),
    signal
  });

  if (!res.ok) throw new Error(`OpenAI streaming failed: ${res.status}`);

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('No response body from OpenAI-compatible endpoint');

  let buffer = '';
  let rawChunkCount = 0;
  let didReceiveDone = false;
  
  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel(); } catch {}
      throw new DOMException('Aborted', 'AbortError');
    }

    const { done, value } = await reader.read();
    if (done) break;

    rawChunkCount++;
    const rawText = decoder.decode(value, { stream: true });

    buffer += rawText;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Guard against processing chunks after [DONE]
      if (didReceiveDone) {
        console.log(`[streamFromOpenAI] Dropping chunk after [DONE]: "${line.substring(0, 50)}..."`);
        continue;
      }

      const clean = line.startsWith('data:') ? line.replace(/^data:\s*/, '') : line;
      console.log(`[streamFromOpenAI] Parsed line #${rawChunkCount}: "${clean.substring(0, 100)}${clean.length > 100 ? '...' : ''}"`);
      
      if (clean === '[DONE]') {
        console.log(`[streamFromOpenAI] Received [DONE], rawChunkCount=${rawChunkCount}, breaking loop`);
        didReceiveDone = true;
        break; // Exit the for loop, will call onDone after processing remaining buffer content
      }

      try {
        const parsed = JSON.parse(clean);
        const delta = parsed?.choices?.[0]?.delta;
        
        const token = delta?.content;
        const reasoning = delta?.reasoning_content || delta?.reasoning || delta?.thought || delta?.thinking;
        
        console.log(`[streamFromOpenAI] Extracted token: ${!!token}, reasoning: ${!!reasoning}`);
        
        // Handle reasoning blocks - send tags only at start/end, not per chunk
        if (reasoning) {
          if (!inReasoningBlock) {
            onToken('<thinking>');
            inReasoningBlock = true;
          }
          onToken(reasoning);
        } else if (token && inReasoningBlock) {
          // Reasoning ended, switch back to regular content
          onToken('</thinking>');
          inReasoningBlock = false;
          onToken(token);
        } else if (token) {
          onToken(token);
        }
      } catch (err) {
        console.warn('⚠️ Failed to parse streamed chunk:', clean, err);
      }
    }
    
    // Early exit if we received [DONE] or signal was aborted
    if (didReceiveDone || signal?.aborted) break;
  }

  // Close any open reasoning block at end of stream
  if (inReasoningBlock) {
    inReasoningBlock = false;
  }

  if (onDone) onDone();
}

// ✅ Non-streaming fallback
export async function sendToOpenAI({ model, messages, signal }: ChatRequestOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoint = config.get<string>('apiLLM.apiURL.endpoint');

  if (!endpoint) {
    vscode.window.showErrorMessage('❌ No endpoint configured in localAIAssistant settings.');
    return 'Error: No endpoint';
  }

  let finalModel: string;
  try {
    const ensured = await ensureOpenAIModel(model);
    if (!ensured) return 'Error: No model selected';
    finalModel = ensured;
  } catch (err: any) {
    return `Error: ${err.message || err}`;
  }

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);
  const apiKey = await getApiKey();

  try {
    const res = await fetch(`${normalizedEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model: finalModel, messages }),
      signal
    });

    if (res.status === 401 && !apiKey) {
      const response = await vscode.window.showWarningMessage(
        '🔐 This endpoint requires an API key. Enter it now?',
        'Yes',
        'Later'
      );
      if (response === 'Yes') vscode.commands.executeCommand('extension.setApiKey');
      return 'Error: Unauthorized';
    }

    const json = await res.json() as ChatResponse;
    return json.choices?.[0]?.message?.content ?? '<No response received: Service or Model might not be set up correctly>';
  } catch (err) {
    //vscode.window.showErrorMessage(`Request failed: ${err}`);
    console.error('OpenAI proxy error:', err);
    return `Error: ${err}`;
  }
}
