import * as vscode from 'vscode';

export function getCodeEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.scheme !== 'vscode-webview') {
    return active;
  }
  return vscode.window.visibleTextEditors.find(
    (ed) => ed.document.uri.scheme !== 'vscode-webview'
  );
}
