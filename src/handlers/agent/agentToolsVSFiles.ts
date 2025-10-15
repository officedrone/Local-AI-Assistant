// src/handlers/agent/agentToolsVSFiles.ts
import * as vscode from 'vscode';

/**
 * Shape of a single text edit requested by the LLM/webview.
 */
interface EditChange {
  start: { line: number; character: number };
  end: { line: number; character: number };
  newText: string;
}

/**
 * Message payload for an edit request.
 */
interface EditMessage {
  type: 'editFile';
  uri: string;
  edits: EditChange[];
}

/**
 * Handle an edit request from the webview/LLM.
 * Applies the requested edits to the given file and notifies the webview of the result.
 */
export async function handleEditMessage(msg: EditMessage, webview: vscode.Webview) {
  try {
    const uri = vscode.Uri.parse(msg.uri);
    const doc = await vscode.workspace.openTextDocument(uri);

    // Generate and send preview
    const preview = generateEditPreview(msg.edits);
    webview.postMessage({
      type: 'editPreview',
      content: preview,
      uri: msg.uri
    });

    // Prompt the user before applying edits
    const choice = await vscode.window.showInformationMessage(
      `AI wants to edit ${uri.fsPath}`,
      { modal: true }, // makes it a blocking modal dialog
      'Allow',
      'Deny'
    );

    if (choice !== 'Allow') {
      webview.postMessage({
        type: 'editResult',
        uri: msg.uri,
        success: false,
        error: 'Edit denied by user'
      });
      return; // bail out early
    }

    const edit = new vscode.WorkspaceEdit();
    for (const change of msg.edits) {
      const range = new vscode.Range(
        new vscode.Position(change.start.line, change.start.character),
        new vscode.Position(change.end.line, change.end.character)
      );
      edit.replace(uri, range, change.newText);
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      await doc.save();
      webview.postMessage({ type: 'editResult', uri: msg.uri, success: true });
    } else {
      webview.postMessage({
        type: 'editResult',
        uri: msg.uri,
        success: false,
        error: 'WorkspaceEdit could not be applied'
      });
    }
  } catch (err) {
    webview.postMessage({
      type: 'editResult',
      uri: msg.uri,
      success: false,
      error: String(err)
    });
  }
}

/**
 * Generate a human-readable preview of file edits.
 * @param edits - Array of edit changes (start, end, newText)
 * @returns Formatted string with line numbers and changes
 */
export function generateEditPreview(edits: EditChange[]): string {
  if (!edits || edits.length === 0) return 'No changes to preview';

  const lines = [];
  for (const [index, edit] of edits.entries()) {
    const startLine = edit.start.line + 1; // Convert 0-based to 1-based
    const endLine = edit.end.line + 1;
    const isReplace = edit.newText.trim() !== '';
    const range = `${startLine}${endLine > startLine ? `-${endLine}` : ''}`;
    const summary = isReplace
      ? `Replace line ${range} with:\n${edit.newText.trim()}`
      : `Delete line ${range}`;

    lines.push(`✅ Edit ${index + 1}: ${summary}`);
  }

  return lines.join('\n\n');
}
