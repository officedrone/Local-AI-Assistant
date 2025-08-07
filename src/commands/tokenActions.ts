import encodingForModel from 'gpt-tokenizer';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

//Count tokens in a list of messages.
export function countMessageTokens(messages: { role: string; content: string }[]): number {
  let total = 0;
  for (const m of messages) {
    total += encodingForModel.encode(m.content).length;
    total += 4; // metadata padding
  }
  return total;
}

//Count tokens in a plain text string.
export function countTextTokens(text: string): number {
  return encodingForModel.encode(text).length;
}

//Count tokens in the currently active file, if context is enabled.
export function getFileContextTokens(): number {
  const includeCtx = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('includeFileContext', true);
  if (!includeCtx) {
    return 0;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme === 'vscode-webview') {
    return 0;
  }
  return countTextTokens(editor.document.getText());
}

//Chat bubbles count token
export function getChatTokenCount(): number {
  return sessionTokenCount - getFileContextTokens();
}



//Total tokens count logic
let sessionTokenCount = 0;

//Add tokens to the session total.
export function addToSessionTokenCount(tokens: number): void {
  sessionTokenCount += tokens;
}

//Reset the session token count.
export function resetSessionTokenCount(): void {
  sessionTokenCount = 0;
}

//Get the current session token count.
export function getSessionTokenCount(): number {
  return sessionTokenCount;
}