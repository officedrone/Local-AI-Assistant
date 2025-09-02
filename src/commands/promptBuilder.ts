import * as vscode from 'vscode';
import {
  validationPrompt,
  completionPrompt,
  userValidationMessage,
  userCompletionMessage,
  chatPrompt
} from '../static/prompts';

export type PromptMode = 'validate' | 'complete' | 'chat';

export interface PromptContext {
  code: string;
  mode: PromptMode;
  fileContext?: string;
  language?: string;
}

/**
 * Detect the active document's programming language using VS Code API.
 */
export async function getLanguage(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return editor.document.languageId;
  } else {
    throw new Error('No active editor found');
  }
}

/**
 * Get the configured context size from settings.
 */
function getContextSize(): number {
  return vscode.workspace
    .getConfiguration('localAIAssistant')
    .get<number>('context.contextSize', 4096);
}

/**
 * Build messages for OpenAI's chat endpoint.
 */
export function buildOpenAIMessages({
  code,
  mode,
  fileContext,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(language, fileContext, contextSize);
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, fileContext, language, contextSize);
  } else {
    systemPrompt = completionPrompt(code, fileContext, language, contextSize);
  }

  const userPrompt =
    mode === 'chat'
      ? code.trim()
      : mode === 'validate'
      ? userValidationMessage(code, language)
      : userCompletionMessage(code, language);

  return [
    { role: 'system', content: systemPrompt.trim() },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Build messages for Ollama's chat endpoint.
 */
export function buildOllamaMessages({
  code,
  mode,
  fileContext,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(language, fileContext);
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, undefined, language, contextSize);
  } else {
    systemPrompt = completionPrompt(code, undefined, language, contextSize);
  }

  const userPrompt =
    mode === 'chat'
      ? code.trim()
      : mode === 'validate'
      ? userValidationMessage(code, language)
      : userCompletionMessage(code, language);

  return [
    { role: 'system', content: systemPrompt.trim() },
    { role: 'user', content: userPrompt }
  ];
}
