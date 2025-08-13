import * as vscode from 'vscode';
import { sendToOpenAI, fetchOpenAiModels } from './openaiProxy';
import { sendToOllama, fetchOllamaTags } from './ollamaProxy';
import { handleStreamingResponse } from './streamingHandler';

export interface ChatRequestOptions {
  model?: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  panel?: vscode.WebviewPanel;
}

export async function routeChatRequest({
  model,
  messages,
  signal,
  panel,
}: ChatRequestOptions): Promise<string | void> {
  const cfg = vscode.workspace.getConfiguration('localAIAssistant.apiLLM.config');
  const apiTypeRaw = cfg.get<string>('apiType', 'OpenAI');
  const apiType = apiTypeRaw.toLowerCase();

  const trimmedModel = model?.trim(); // model is optional

  // ✅ Streaming path
  if (panel) {
    await handleStreamingResponse({
      model: trimmedModel ?? '', // pass empty string if undefined
      messages,
      signal,
      panel,
      apiType,
    });
    return;
  }

  // ✅ Non-streaming fallback
  try {
    let response: string;

    if (apiType === 'ollama') {
      const ollamaMessages = messages.filter(
        (m): m is { role: 'system' | 'user'; content: string } =>
          m.role !== 'assistant'
      );
      response = await sendToOllama({ model: trimmedModel ?? '', messages: ollamaMessages, signal });
    } else {
      response = await sendToOpenAI({ model: trimmedModel ?? '', messages, signal });
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

// Removed getDefaultModel — no longer needed

async function showHealthMessage(apiType: string) {
  let serviceUp = false;
  let hasModels = false;

  try {
    if (apiType === 'ollama') {
      const tags = await fetchOllamaTags();
      serviceUp = true;
      hasModels = tags.length > 0;
    } else {
      const models = await fetchOpenAiModels();
      serviceUp = true;
      hasModels = models.length > 0;
    }
  } catch {
    serviceUp = false;
  }

  let message: string;
  if (!serviceUp) {
    message =
      '🔌 LLM service may be offline or misconfigured. Check your endpoint and authentication.';
  } else if (!hasModels) {
    message =
      apiType === 'ollama'
        ? '🚦 Ollama reachable but returned no tags. Ensure your models are loaded.'
        : '🚦 OpenAI-compatible service reachable but no models loaded. Use CTRL+SHIFT+ALT+M to select one.';
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
