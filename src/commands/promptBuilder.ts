// src/commands/promptBuilder.ts

import {
  validationPrompt,
  completionPrompt,
  userValidationMessage,
  userCompletionMessage
} from '../static/prompts';

export type PromptMode = 'validate' | 'complete' | 'chat';

export interface PromptContext {
  code: string;         // input text or selected code
  mode: PromptMode;
  fileContext?: string; // full text of open file, if "Include file context" is checked
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
  fileContext
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  // 1) Build the base system prompt
  let systemPrompt: string;

  if (mode === 'chat') {
    systemPrompt = 
      'You are a helpful AI assistant that answers developer questions clearly and concisely. Provide only relevant code block unless the user requests the full file.';
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, fileContext);
  } else {
    systemPrompt = completionPrompt(code, fileContext);
  }

  // 2) If fileContext is provided, append it for richer context
  if (fileContext) {
    systemPrompt = systemPrompt.trim() +
      '\n\nHere is the content of the currently open file for context:\n' +
      '```\n' +
      fileContext.trim() +
      '\n```';
  }

  // Trim final system prompt
  systemPrompt = systemPrompt.trim();

  // 3) Build the user prompt
  let userPrompt: string;
  if (mode === 'chat') {
    userPrompt = code.trim();
  } else if (mode === 'validate') {
    userPrompt = userValidationMessage(code).trim();
  } else {
    userPrompt = userCompletionMessage(code).trim();
  }

  // 4) Return the two-message array
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt }
  ];
}
