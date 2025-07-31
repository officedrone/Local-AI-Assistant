// src/api/ollamaProxy.ts

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

/**
 * Sends a structured chat request to the local Ollama API.
 */
export async function sendToOllama({
  model,
  messages,
  signal
}: ChatRequestOptions): Promise<string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const base = config.get<string>('ollamaEndpoint') ?? 'http://localhost:11434';
  const endpoint = `${base.replace(/\/$/, '')}/api/chat`;

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

/**
 * Fetches available Ollama tags (models).
 */
export async function fetchOllamaTags(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const base = config.get<string>('ollamaEndpoint') ?? 'http://localhost:11434';
  const endpoint = `${base.replace(/\/$/, '')}/api/tags`;

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
