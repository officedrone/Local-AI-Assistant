// src/commands/promptBuilder.ts

import * as vscode from 'vscode';
import {
  validationPrompt,
  completionPrompt,
  userValidationMessage,
  userCompletionMessage
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
 * Construct a chat-style message array for the LLM.
 * - In "chat" mode, uses a generic assistant prompt + your input.
 * - In "validate" or "complete" modes, applies static templates.
 * If fileContext is provided, it’s appended to the system prompt in all modes.
 */
export function buildChatMessages({
  code,
  mode,
  fileContext,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  // Build the base system prompt
  let systemPrompt: string;

  if (mode === 'chat') {
    systemPrompt = `You are a helpful AI assistant that answers developer questions clearly and concisely. Provide only relevant code blocks unless the user requests the full file. The language in use is ${language}.`;

    if (fileContext) {
      systemPrompt += `\n\nHere is the current file context:\n${fileContext}`;
    }
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, fileContext, language);
  } else {
    systemPrompt = completionPrompt(code, fileContext, language);
  }

  // Build the user prompt
  let userPrompt: string;
  if (mode === 'chat') {
    userPrompt = code.trim();
  } else if (mode === 'validate') {
    userPrompt = userValidationMessage(code, language);
  } else {
    userPrompt = userCompletionMessage(code, language);
  }

  // Return the two-message array
  return [
    { role: 'system', content: systemPrompt.trim() },
    { role: 'user',   content: userPrompt }
  ];
}
