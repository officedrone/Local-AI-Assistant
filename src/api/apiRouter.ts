// src/api/apiRouter.ts

import * as vscode from 'vscode';
import { sendToOpenAI, fetchOpenAiModels } from './openaiProxy';
import { sendToOllama, fetchOllamaTags } from './ollamaProxy';
import { handleStreamingResponse } from './streamingHandler';

let healthInterval: NodeJS.Timeout | null = null;

export interface ChatRequestOptions {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  panel?: vscode.WebviewPanel;

  onToken?: (chunk: string) => void;
  onDone?: () => void;
}

export async function routeChatRequest({
  model,
  messages,
  signal,
  panel,
  onToken,
  onDone,
}: ChatRequestOptions): Promise<string | void> {
  const cfg = vscode.workspace.getConfiguration('localAIAssistant.apiLLM.config');
  const apiTypeRaw = cfg.get<string>('apiType', 'OpenAI');
  const apiType = apiTypeRaw.toLowerCase();
  const trimmedModel = model?.trim() ?? '';

  // streaming path
  if (panel) {
    try {
      await handleStreamingResponse({
        model: trimmedModel,
        messages,
        signal,
        panel,
        apiType,
        onToken,
        onDone,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.log('[apiRouter] stream aborted');
        panel.webview.postMessage({ type: 'stoppedStream', message: '' });
        return;
      }
      throw err;
    }
    return;
  }

  // non-streaming fallback
  try {
    let response: string;

    if (apiType === 'ollama') {
      const ollamaMessages = messages.filter(
        (m): m is { role: 'system' | 'user'; content: string } =>
          m.role !== 'assistant'
      );
      response = await sendToOllama({
        model: trimmedModel,
        messages: ollamaMessages,
        signal,
      });
    } else {
      response = await sendToOpenAI({
        model: trimmedModel,
        messages,
        signal,
      });
    }

    if (response.startsWith('Error:')) {
      await showHealthMessage(apiType);
    }

    return response;
  } catch (err) {
    console.error('Chat routing error:', err);
    await showHealthMessage(apiType);
    return `Error: ${err}`;
  }
}

//Get models
export async function fetchAvailableModels(): Promise<string[]> {
  const cfg = vscode.workspace.getConfiguration('localAIAssistant.apiLLM.config');
  const apiTypeRaw = cfg.get<string>('apiType', 'OpenAI');
  const apiType = apiTypeRaw.toLowerCase();

  try {
    if (apiType === 'ollama') {
      return await fetchOllamaTags();
    } else {
      return await fetchOpenAiModels();
    }
  } catch (err) {
    console.error('Error fetching models:', err);
    return [];
  }
}


// Start periodic health checks (every 10s) while svc up
export function startHealthLoop(panel: vscode.WebviewPanel) {
  if (healthInterval) return; // already running

  healthInterval = setInterval(async () => {
    const health = await checkServiceHealth();

    // Send status to webview
    panel.webview.postMessage({ type: 'apiReachability', value: health });

    // Stop the loop if service is down OR has no models
    if (!health.serviceUp || !health.hasModels) {
      stopHealthLoop();
    }
  }, 10_000);
}


// Stop the loop
export function stopHealthLoop() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

//Used for the timeout override
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Timeout')), ms);
    promise
      .then((res) => {
        clearTimeout(id);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

export async function checkServiceHealth(): Promise<{
  serviceUp: boolean;
  hasModels: boolean;
  apiType: string;
  models: string[];
}> {
  const cfg = vscode.workspace.getConfiguration('localAIAssistant.apiLLM.config');
  const apiTypeRaw = cfg.get<string>('apiType', 'OpenAI');
  const apiType = apiTypeRaw.toLowerCase();

  let serviceUp = false;
  let hasModels = false;
  let modelsList: string[] = [];

  try {
    if (apiType === 'ollama') {
      const tags = await withTimeout(fetchOllamaTags(), 2000);
      if (Array.isArray(tags)) {
        serviceUp = true;
        modelsList = tags;
        hasModels = tags.length > 0;
      }
    } else {
      const models = await withTimeout(fetchOpenAiModels(), 2000);
      if (Array.isArray(models)) {
        serviceUp = true;
        modelsList = models;
        hasModels = models.length > 0;
      }
    }
  } catch {
    serviceUp = false;
  }

  return { serviceUp, hasModels, apiType, models: modelsList };
}

async function showHealthMessage(apiTypeFromRoute?: string) {
  // Reuse the unified health check
  const { serviceUp, hasModels, apiType } = await checkServiceHealth();

  let message: string;
  if (!serviceUp) {
    message =
      '🔌 LLM service may be offline or misconfigured. Check your endpoint and authentication.';
  } else if (!hasModels) {
    if (apiType === 'ollama') {
      message =
        '🚦 Ollama is reachable but returned no tags. Ensure your models are loaded with `ollama pull <model>`.';
    } else {
      message =
        '🚦 OpenAI‑compatible service is reachable but returned no models from /v1/models. ' +
        'Verify that the service has models deployed. Press CTRL+ALT+SHIFT+M (CMD+ALT+SHIFT+M for Mac) to select a model and load it if your environment supports JIT.';
    }
  } else {
    message = '✅ Service is healthy but request failed. See console for details.';
  }

  vscode.window
    .showErrorMessage(message, 'Open Settings')
    .then((sel) => {
      if (sel === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:officedrone.local-ai-assistant'
        );
      }
    });
}
