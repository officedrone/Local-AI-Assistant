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
 * Build messages for OpenAI's chat endpoint.
 */
export function buildOpenAIMessages({
  code,
  mode,
  fileContext,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = `You are a helpful AI assistant that answers developer questions clearly and as concisely as possible. If providing code blocks, provide only relevant code blocks and not the full file unless the user requests the full file. The language in use is ${language}`;

    if (fileContext) {
      systemPrompt += `\n\nHere is the current file context:\n${fileContext}`;
    }
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, fileContext, language);
  } else {
    systemPrompt = completionPrompt(code, fileContext, language);
  }

  let userPrompt: string;
  if (mode === 'chat') {
    userPrompt = code.trim();
  } else if (mode === 'validate') {
    userPrompt = userValidationMessage(code, language);
  } else {
    userPrompt = userCompletionMessage(code, language);
  }

  return [
    { role: 'system', content: systemPrompt.trim() },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Build messages for Ollama's chat endpoint.
 * Modified to include file context if provided.
 */
export function buildOllamaMessages({
  code,
  mode,
  fileContext,
  language = 'plaintext'
}: PromptContext): { role: 'system' | 'user'; content: string }[] {
  let systemPrompt = '';

  if (mode === 'chat') {
    systemPrompt = `You are a helpful AI assistant that answers developer questions clearly and as concisely as possible. If providing code blocks, provide only relevant code blocks and not the full file unless the user requests the full file. The language in use is ${language}`;

    if (fileContext) {
      systemPrompt += `\n\nHere is the current file context:\n${fileContext}`;
    }
  } else if (mode === 'validate') {
    systemPrompt = validationPrompt(code, undefined, language);
  } else {
    systemPrompt = completionPrompt(code, undefined, language);
  }

  let userPrompt: string;
  if (mode === 'chat') {
    userPrompt = code.trim();
  } else if (mode === 'validate') {
    userPrompt = userValidationMessage(code, language);
  } else {
    userPrompt = userCompletionMessage(code, language);
  }

  return [
    { role: 'system', content: systemPrompt.trim() },
    { role: 'user', content: userPrompt }
  ];
}
