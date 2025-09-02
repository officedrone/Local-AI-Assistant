//src/handlers/contextHandler.ts
import * as vscode from 'vscode';
import { getFileContextTokens } from '../commands/tokenActions';

let lastFileHash: number | undefined;
let contextDirty = false;

export function markContextDirty(doc: vscode.TextDocument) {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === doc.uri.toString()) {
    contextDirty = true;
  }
}

export function shouldIncludeContext(fileText: string, isFirstMessage: boolean): boolean {
  const currentHash = simpleHash(fileText);
  if (isFirstMessage || contextDirty || currentHash !== lastFileHash) {
    lastFileHash = currentHash;
    contextDirty = false;
    return true;
  }
  return false;
}

export function getFileContext(): string | undefined {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme === 'vscode-webview') return undefined;
  return ed.document.getText();
}

export function getCurrentFileContextTokens(): number {
  return getFileContextTokens();
}

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // keep as 32‑bit int
  }
  return hash;
}
