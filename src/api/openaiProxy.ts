import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

export interface ChatRequestOptions {
  model: string;
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

// ✅ Streaming support
export async function streamFromOpenAI({
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
  const endpoint = config.get<string>('endpoint');

  if (!endpoint) throw new Error('No endpoint configured');

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);
  const apiKey = config.get<string>('apiKey') ??
    await vscode.extensions.getExtension('officedrone.local-ai-assistant')?.exports?.getSecret?.('localAIAssistant.apiLLM.config.apiKey');

  const res = await fetch(`${normalizedEndpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    }),
    signal
  });

  if (!res.ok) throw new Error(`OpenAI streaming failed: ${res.status}`);

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body from OpenAI');

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim().startsWith('data:')) continue;

      const jsonStr = line.replace(/^data:\s*/, '');
      if (jsonStr === '[DONE]') {
        if (onDone) onDone();
        return;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        const token = parsed?.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch (err) {
        console.warn('Failed to parse OpenAI stream chunk:', line);
      }
    }
  }

  if (onDone) onDone();
}

// ✅ Non-streaming fallback
export async function sendToOpenAI({ model, messages, signal }: ChatRequestOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoint = config.get<string>('endpoint');

  if (!endpoint) {
    vscode.window.showErrorMessage('❌ No endpoint configured in localAIAssistant settings.');
    return 'Error: No endpoint';
  }

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);
  const apiKey = config.get<string>('apiKey') ??
    await vscode.extensions.getExtension('officedrone.local-ai-assistant')?.exports?.getSecret?.('localAIAssistant.apiLLM.config.apiKey');

  try {
    const res = await fetch(`${normalizedEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages }),
      signal
    });

    if (res.status === 401 && !apiKey) {
      const response = await vscode.window.showWarningMessage(
        '🔐 This endpoint requires an API key. Enter it now?',
        'Yes',
        'Later'
      );
      if (response === 'Yes') {
        vscode.commands.executeCommand('extension.setApiKey');
      }
      return 'Error: Unauthorized';
    }

    const json = await res.json() as ChatResponse;
    return json.choices?.[0]?.message?.content ?? 'No response';
  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Request failed: ${err}`);
    console.error('OpenAI proxy error:', err);
    return `Error: ${err}`;
  }
}

// ✅ Fetch available models
export async function fetchOpenAiModels(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoint = config.get<string>('endpoint');
  const apiKey = config.get<string>('apiKey') ??
    await vscode.extensions.getExtension('officedrone.local-ai-assistant')?.exports?.getSecret?.('localAIAssistant.apiLLM.config.apiKey');

  if (!endpoint) {
    vscode.window.showErrorMessage('❌ No endpoint configured.');
    return [];
  }

  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint);

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
    return data.data?.map((model) => model.id) ?? [];

  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Failed to fetch model list: ${err}`);
    console.error('Model list error:', err);
    return [];
  }
}
