//src/api/ollamaProxy.ts
import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

// 🧠 Filter out assistant messages
function filterOllamaMessages(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): { role: 'system' | 'user'; content: string }[] {
  return messages.filter((m): m is { role: 'system' | 'user'; content: string } => m.role !== 'assistant');
}

export interface ChatRequestOptions {
  model?: string;
  messages: { role: 'system' | 'user'; content: string }[];
  signal?: AbortSignal;
}

interface ChatResponse {
  message?: {
    content?: string;
  };
}

// ✅ Normalize endpoint to include /api if missing
function normalizeOllamaEndpoint(endpoint: string): string {
  return endpoint.includes('/api') ? endpoint : `${endpoint.replace(/\/$/, '')}/api`;
}

// 🔑 Helper to retrieve secure API key
async function getApiKey(): Promise<string | undefined> {
  return await vscode.extensions
    .getExtension('officedrone.local-ai-assistant')
    ?.exports?.getSecret?.('localAIAssistant.apiLLM.config.apiKey');
}

// 🧠 Non-streaming fallback
export async function sendToOllama({ model, messages, signal }: ChatRequestOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const baseEndpoint = config.get<string>('apiLLM.apiURL.endpoint') ?? 'http://localhost:11434';
  const normalizedEndpoint = normalizeOllamaEndpoint(baseEndpoint);

  const apiKey = await getApiKey();

  let finalModel = model?.trim() || config.get<string>('apiLLM.config.model')?.trim();

  if (!finalModel) {
    const tags = await fetchOllamaTags();
    if (tags.length === 0) {
      vscode.window.showErrorMessage('🚫 No Ollama models available. Load models first by pressing CTRL+SHIFT+ALT+M (CMD+SHIFT+ALT+M on Mac).');
      return 'Error: No models available';
    }

    const selected = await vscode.window.showQuickPick(tags, {
      placeHolder: 'Select an Ollama model to use',
    });

    if (!selected) {
      console.warn('[sendToOllama] aborted: user did not select a model');
      return 'Error: No model selected';
    }

    await config.update('apiLLM.config.model', selected, vscode.ConfigurationTarget.Global);
    finalModel = selected;
  }

  try {
    const res = await fetch(`${normalizedEndpoint}/chat`, {
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
        '🔐 Ollama endpoint requires an API key. Enter it now?',
        'Yes',
        'Later'
      );
      if (response === 'Yes') {
        vscode.commands.executeCommand('extension.setApiKey');
      }
      return 'Error: Unauthorized';
    }

    const json = await res.json() as ChatResponse;
    return json.message?.content ?? 'No response';
  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Ollama request failed: ${err}`);
    console.error('Ollama proxy error:', err);
    return `Error: ${err}`;
  }
}

// ✅ Streaming support via /chat
export async function streamFromOllama({
  model,
  messages,
  signal,
  onToken,
  onDone,
}: {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onDone?: () => void;
}): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const baseEndpoint = config.get<string>('apiLLM.apiURL.endpoint') ?? 'http://localhost:11434';
  const normalizedEndpoint = normalizeOllamaEndpoint(baseEndpoint);

  const apiKey = await getApiKey();

  let finalModel = model?.trim() || config.get<string>('apiLLM.config.model')?.trim();

  if (!finalModel) {
    const tags = await fetchOllamaTags();
    if (tags.length === 0) {
      vscode.window.showErrorMessage('🚫 No Ollama models available. Load models first by pressing CTRL+SHIFT+ALT+M (CMD+SHIFT+ALT+M on Mac).');
      throw new Error('No models available');
    }

    const selected = await vscode.window.showQuickPick(tags, {
      placeHolder: 'Select an Ollama model to use',
    });

    if (!selected) {
      console.warn('[streamFromOllama] aborted: user did not select a model');
      throw new Error('No model selected');
    }

    await config.update('apiLLM.config.model', selected, vscode.ConfigurationTarget.Global);
    finalModel = selected;
  }

  const filteredMessages = filterOllamaMessages(messages);

  console.log('📤 Ollama request payload:', JSON.stringify({ model: finalModel, messages: filteredMessages, stream: true }, null, 2));

  const res = await fetch(`${normalizedEndpoint}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model: finalModel, messages: filteredMessages, stream: true }),
    signal
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('🛑 Ollama streaming error response:', errorText);
    throw new Error(`Ollama streaming failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body from Ollama');
  }

  let buffer = '';
  while (true) {
    if (signal?.aborted) {
      console.log('[OllamaProxy] Aborted by user');
      try { await reader.cancel(); } catch {}
      throw new DOMException('Aborted', 'AbortError');
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const token = parsed?.message?.content;
        if (token) onToken(token);
        if (parsed?.done && onDone) onDone();
      } catch {
        console.warn('⚠️ Failed to parse streamed chunk:', line);
      }
    }
  }

  if (onDone) onDone();
}

// ✅ Fetch available Ollama models
export async function fetchOllamaTags(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const baseEndpoint = config.get<string>('apiLLM.apiURL.endpoint') ?? 'http://localhost:11434';
  const normalizedEndpoint = normalizeOllamaEndpoint(baseEndpoint);

  const apiKey = await getApiKey();

  try {
    const res = await fetch(`${normalizedEndpoint}/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as { models?: { name: string }[] };
    return Array.isArray(data.models)
      ? data.models.map((m) => m.name).filter(Boolean)
      : [];
  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Failed to fetch Ollama model list: ${err}`);
    console.error('Ollama model list error:', err);
    return [];
  }
}
