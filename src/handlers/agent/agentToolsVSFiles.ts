// src/handlers/agent/agentToolsVSFiles.ts
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Shape of a single text edit requested by the LLM/webview.
 * Even though character fields exist, we ignore them and operate line‑wise.
 */
interface EditChange {
  start: { line: number; character?: number };
  end: { line: number; character?: number };
  newText: string;
}

/**
 * Message payload for an edit request.
 */
export interface EditMessage {
  type: 'editFile';
  uri: string;
  edits: EditChange[];
}

/** Helpers */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function ensureEndsWithNewline(text: string) {
  return text.endsWith('\n') ? text : text + '\n';
}

// Write a temp file and return its vscode.Uri
async function writeTempFile(filenameHint: string, contents: string) {
  const tempDir = path.join(os.tmpdir(), 'local-ai-assistant-previews');
  await fs.mkdir(tempDir, { recursive: true });
  const safeName = filenameHint.replace(/[\/\\:]/g, '_').slice(0, 120);
  const filename = `${Date.now()}-${safeName}`;
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, contents, { encoding: 'utf8' });
  return vscode.Uri.file(filePath);
}

/**
 * Handle an edit request from the webview/LLM.
 * Applies the requested edits to the given file and notifies the webview of the result.
 * This version is line‑centric: always replaces whole lines.
 */
export async function handleEditMessage(msg: EditMessage, webview: vscode.Webview) {
  try {
    if (!msg || typeof msg.uri !== 'string') {
      webview.postMessage({
        type: 'editResult',
        uri: String(msg?.uri ?? ''),
        success: false,
        error: 'Invalid edit message: missing uri'
      });
      return;
    }

    const uri = vscode.Uri.parse(msg.uri);
    const doc = await vscode.workspace.openTextDocument(uri);

    if (!Array.isArray(msg.edits) || msg.edits.length === 0) {
      webview.postMessage({
        type: 'editResult',
        uri: uri.toString(),
        success: false,
        error: 'No edits provided'
      });
      return;
    }

    // Defensive sort: apply later edits first so earlier edits don't shift positions
    const edits = msg.edits.slice().sort((a, b) => b.start.line - a.start.line);

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const e of edits) {
      const sLine = clamp(Number(e.start?.line) || 0, 0, Math.max(0, doc.lineCount - 1));
      const eLine = clamp(Number(e.end?.line) || sLine, 0, Math.max(0, doc.lineCount - 1));

      // Always snap to full lines
      const start = new vscode.Position(sLine, 0);
      const end = new vscode.Position(eLine + 1, 0);

      const replacement = ensureEndsWithNewline(e.newText ?? '');
      workspaceEdit.replace(uri, new vscode.Range(start, end), replacement);
    }

    const success = await vscode.workspace.applyEdit(workspaceEdit);

    webview.postMessage({
      type: 'editResult',
      uri: uri.toString(),
      success,
      error: success ? null : 'applyEdit returned false'
    });
  } catch (err) {
    webview.postMessage({
      type: 'editResult',
      uri: String(msg?.uri ?? ''),
      success: false,
      error: String(err)
    });
  }
}

/**
 * Handle a requestPreview message from the webview.
 * Generates a preview of the edits without applying them and opens a native diff.
 */
export async function handleRequestPreview(uri: string, edits: EditChange[], webview: vscode.Webview) {
  try {
    const vscodeUri = vscode.Uri.parse(uri);
    const doc = await vscode.workspace.openTextDocument(vscodeUri);
    const originalText = doc.getText();

    // Generate lightweight preview text for webview
    const preview = generateEditPreview(edits, originalText);
    const content = (edits || []).map(e => e.newText ?? '').join('\n');

    console.log('EXT → posting editPreview', { uri, contentLen: content.length, previewLen: preview?.length ?? 0 });
    webview.postMessage({
      type: 'editPreview',
      uri,
      content,
      edits,
      preview
    });

    // --- Also open a native VS Code diff view for a richer preview ---
    try {
      // Apply edits in memory line-wise (matching handleEditMessage semantics)
      const origLines = originalText.split(/\r?\n/);
      const linesCopy = origLines.slice();

      const sorted = (edits || []).slice().sort((a, b) => b.start.line - a.start.line);
      for (const e of sorted) {
        const s = Math.max(0, Math.min(e.start.line, linesCopy.length));
        const en = Math.max(0, Math.min(e.end.line, linesCopy.length - 1));
        const newLines = (e.newText ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
        linesCopy.splice(s, en - s + 1, ...newLines);
      }

      const afterText = linesCopy.join('\n') + (originalText.endsWith('\n') ? '\n' : '');

      // Write temp files and open diff
      const leftUri = await writeTempFile('orig-' + path.basename(vscodeUri.fsPath || 'file'), originalText);
      const rightUri = await writeTempFile('mod-' + path.basename(vscodeUri.fsPath || 'file'), afterText);
      const title = `${path.basename(vscodeUri.fsPath || uri)} (preview)`;

      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    } catch (diffErr) {
      console.error('Failed to open diff preview', diffErr);
      // Non-fatal: webview already has lightweight preview
    }
    // --- end diff logic ---

  } catch (err) {
    webview.postMessage({
      type: 'editPreview',
      uri,
      content: '',
      edits,
      preview: `Error generating preview: ${String(err)}`
    });
  }
}

/**
 * Generate a human-readable preview of file edits.
 * Shows before/after blocks with line numbers.
 */
export function generateEditPreview(edits: EditChange[], docText?: string): string {
  if (!edits || edits.length === 0) return 'No changes to preview';

  const docLines = docText ? docText.split(/\r?\n/) : [];
  const lines: string[] = [];

  for (const [index, edit] of edits.entries()) {
    const startLine = edit.start.line; // 0-based
    const endLine = edit.end.line;
    const range = startLine === endLine ? `${startLine + 1}` : `${startLine + 1}-${endLine + 1}`;

    // Grab the original lines if we have the document text
    const before = docLines.length
      ? docLines.slice(startLine, endLine + 1).map((l, i) => `${startLine + 1 + i}: ${l}`).join('\n')
      : '(original text unavailable)';

    const afterLines = (edit.newText ?? '').replace(/\n$/, '').split(/\r?\n/);
    const after = afterLines
      .map((l, i) => `${startLine + 1 + i}: ${l}`)
      .join('\n');

    lines.push(
      `🔧 Edit ${index + 1} (lines ${range}):\n` +
      `--- Before ---\n${before}\n` +
      `--- After ---\n${after || '(deleted)'}`
    );
  }

  return lines.join('\n\n');
}
