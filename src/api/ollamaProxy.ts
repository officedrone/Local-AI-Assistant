import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

export interface ChatRequestOptions {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  signal?: AbortSignal;
}

interface ChatResponse {
  message?: {
    content?: string;
  };
}

// Normalize endpoint to include /api if missing
function normalizeOllamaEndpoint(endpoint: string): string {
  return endpoint.includes('/api') ? endpoint : `${endpoint.replace(/\/$/, '')}/api`;
}

// Send chat request to Ollama
export async function sendToOllama({
  model,
  messages,
  signal
}: ChatRequestOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const base = config.get<string>('ollamaEndpoint') ?? 'http://localhost:11434';
  const endpoint = `${normalizeOllamaEndpoint(base)}/chat`;

  const payload = { model, messages };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      vscode.window.showErrorMessage(`🛑 Ollama request failed (${res.status})`);
      return `Error: ${res.status}`;
    }

    const json = (await res.json()) as ChatResponse;
    return json.message?.content ?? 'No response';
  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Ollama proxy error: ${err}`);
    console.error('Ollama proxy error:', err);
    return `Error: ${err}`;
  }
}

// Fetch available Ollama tags
export async function fetchOllamaTags(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const base = config.get<string>('ollamaEndpoint') ?? 'http://localhost:11434';
  const endpoint = `${normalizeOllamaEndpoint(base)}/tags`;

  try {
    const res = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      throw new Error(`Tags HTTP ${res.status}`);
    }

    const data = (await res.json()) as { tags?: string[] };
    return Array.isArray(data.tags) ? data.tags : [];
  } catch (err) {
    vscode.window.showErrorMessage(`🛑 Failed to fetch Ollama tags: ${err}`);
    console.error('Ollama tags error:', err);
    return [];
  }
}
