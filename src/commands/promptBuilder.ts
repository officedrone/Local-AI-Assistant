// src/handlers/promptBuilder.ts

import * as vscode from 'vscode';
import {
  validationPrompt,
  completionPrompt,
  userValidationMessage,
  userCompletionMessage,
  chatPrompt
} from '../static/prompts';

// Shape expected by prompts.ts (string URIs)
export interface NormalizedFileContext {
  uri: string;
  language: string;
  content: string;
}

export type PromptMode = 'validate' | 'complete' | 'chat';

export interface PromptContext {
  code: string;
  mode: PromptMode;
  fileContext?: string;                        // legacy single-file support
  fileContexts?: NormalizedFileContext[];      // ✅ new multi-file support
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
  fileContexts,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(
      language,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined),
      contextSize
    );
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(
      code,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined),
      language,
      contextSize
    );
  } else {
    systemPrompt = completionPrompt(
      code,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined),
      language,
      contextSize
    );
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
  fileContexts,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(
      language,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined)
    );
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(
      code,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined),
      language,
      contextSize
    );
  } else {
    systemPrompt = completionPrompt(
      code,
      fileContexts ??
        (fileContext
          ? [{ uri: 'active', language, content: fileContext }]
          : undefined),
      language,
      contextSize
    );
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
