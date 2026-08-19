// src/handlers/promptBuilder.ts

import * as vscode from 'vscode';
import {
  validationPrompt,
  completionPrompt,
  userValidationMessage,
  userCompletionMessage,
  chatPrompt
} from '../static/prompts';

// Updated shape expected by prompts.ts
export interface NormalizedFileContext {
  uri: string;
  language: string;
  summary: string;
  slices: {
    startLine: number;
    endLine: number;
    lines: { n: number; text: string }[];
  }[];
}

export type PromptMode = 'validate' | 'complete' | 'chat';

export interface PromptContext {
  code: string;
  mode: PromptMode;

  // legacy single-file support
  fileContext?: string;

  // new multi-file support
  fileContexts?: NormalizedFileContext[];

  language?: string;
  capabilities?: { [key: string]: boolean };
  
  // workspace scope files (URIs without content)
  scopeUris?: string[];
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
 * Normalize fileContexts into the structure expected by prompts.
 */
function normalizeFileContexts(
  fileContexts?: NormalizedFileContext[],
  fileContext?: string,
  language?: string
) {
  if (fileContexts && fileContexts.length > 0) {
    return fileContexts.map(f => ({
      uri: f.uri,
      language: f.language,
      summary: f.summary,
      slices: f.slices
    }));
  }

  // Legacy single-file fallback
  if (fileContext) {
    return [{
      uri: 'active',
      language: language ?? 'plaintext',
      summary: 'Active file (legacy mode)',
      slices: []
    }];
  }

  return undefined;
}

/**
 * Build messages for OpenAI's chat endpoint.
 */
export function buildOpenAIMessages({
  code,
  mode,
  fileContext,
  fileContexts,
  language = 'plaintext',
  capabilities = {},
  scopeUris
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  const normalized = normalizeFileContexts(fileContexts, fileContext, language);

  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(
      language,
      normalized,
      contextSize,
      capabilities,
      scopeUris
    );
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(
      code,
      normalized,
      language,
      contextSize,
      capabilities,
      scopeUris
    );
  } else {
    systemPrompt = completionPrompt(
      code,
      normalized,
      language,
      contextSize,
      capabilities,
      scopeUris
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
  language = 'plaintext',
  capabilities = {},
  scopeUris
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  const contextSize = getContextSize();
  const normalized = normalizeFileContexts(fileContexts, fileContext, language);

  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = chatPrompt(
      language,
      normalized,
      contextSize,
      capabilities,
      scopeUris
    );
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(
      code,
      normalized,
      language,
      contextSize,
      capabilities,
      scopeUris
    );
  } else {
    systemPrompt = completionPrompt(
      code,
      normalized,
      language,
      contextSize,
      capabilities,
      scopeUris
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
