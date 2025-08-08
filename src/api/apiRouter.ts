import * as vscode from 'vscode';
import { sendToOpenAI, fetchAvailableModels } from './openaiProxy';
import { sendToOllama, fetchOllamaTags } from './ollamaProxy';
import { handleAiRequest } from '../commands/chatPanel';

export interface ChatRequestOptions {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  signal?: AbortSignal;
  panel?: vscode.WebviewPanel;
}

export async function routeChatRequest({
  model,
  messages,
  signal,
  panel,
}: ChatRequestOptions): Promise<string | void> {
  const cfg = vscode.workspace.getConfiguration('localAIAssistant');
  const apiType = cfg.get<string>('apiType', 'openai')!.toLowerCase();

  // 1) If streaming (panel present), let chatPanel handle it
  if (panel) {
    return handleAiRequest(messages, model, panel);
  }

  // 2) Guard against missing model
  const trimmed = model?.trim();
  if (!trimmed) {
    await showHealthMessage(apiType);
    console.warn('[routeChatRequest] aborted: no model specified');
    return 'Error: No model specified';
  }

  let response: string;
  try {
    // 3) Dispatch to the right backend
    const norm = trimmed.toLowerCase();
    if (norm.startsWith('gpt-')) {
      response = await sendToOpenAI({ model: trimmed, messages, signal });
    } else if (norm.startsWith('llama') || norm.includes('codellama')) {
      response = await sendToOllama({ model: trimmed, messages, signal });
    } else {
      throw new Error(`Unsupported model: ${trimmed}`);
    }

    // 4) If the backend itself returned an error payload, show health
    if (response.startsWith('Error:')) {
      await showHealthMessage(apiType);
    }

    return response;
  } catch (err) {
    // 5) On exception, also run health check
    console.error('Chat routing error:', err);
    await showHealthMessage(apiType);
    return `Error: ${err}`;
  }
}

/**
 * Runs a two-step health check:
 *  1) Can we reach the service?
 *  2) Does it list any models/tags?
 * Then displays an appropriate error message.
 */
async function showHealthMessage(apiType: string) {
  let serviceUp = false;
  let hasModels = false;

  try {
    if (apiType === 'ollama') {
      const tags = await fetchOllamaTags();
      serviceUp = true;
      hasModels = tags.length > 0;
    } else {
      const models = await fetchAvailableModels();
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
    // unlikely, but catch‐all
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
