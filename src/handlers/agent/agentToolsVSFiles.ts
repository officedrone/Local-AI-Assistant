// src/handlers/agent/agentToolsVSFiles.ts
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

interface EditChange {
  start: { line: number; character?: number };
  end: { line: number; character?: number };
  newText: string;
}

export interface EditMessage {
  type: 'editFile';
  uri: string;
  edits: EditChange[];
}

/**
 * Clamp a number between min and max.
 */
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Ensure a string ends with a newline.
 */
function ensureEndsWithNewline(text: string) {
  return text.endsWith('\n') ? text : text + '\n';
}

/**
 * 🔑 Normalize edits to exclusive end (backend always 0-based, exclusive).
 */
function normalizeEdits(edits: EditChange[], doc: vscode.TextDocument): EditChange[] {
  const lastLine = Math.max(0, doc.lineCount - 1);
  const docEnd = doc.lineCount; // exclusive sentinel

  return (edits || []).map(e => {
    // Clamp start and end, allow empty range (insertion)
    const s = clamp(Number(e.start?.line) || 0, 0, lastLine);
    const endExclRaw = Number(e.end?.line);
    const endExcl = Number.isFinite(endExclRaw)
      ? clamp(endExclRaw as number, 0, docEnd)
      : s; // if missing, treat as insertion at start

    // Ensure start <= end (swap if needed to avoid negative ranges)
    const startLine = Math.min(s, endExcl);
    const endLine = Math.max(s, endExcl);

    return {
      start: { line: startLine, character: 0 },
      end:   { line: endLine, character: 0 }, // exclusive end
      newText: e.newText ?? ''
    };
  });
}



/**
 * Write a temporary file for diff previews.
 * Files are stored in the system temp dir under "local-ai-assistant-previews"
 * and prefixed with "LocalAIAssistantPreview-".
 */
async function writeTempFile(filenameHint: string, contents: string) {
  const tempDir = path.join(os.tmpdir(), 'local-ai-assistant-previews');
  await fs.mkdir(tempDir, { recursive: true });
  const safeName = filenameHint.replace(/[\/\\:]/g, '_').slice(0, 120);
  const filename = `LocalAIAssistantPreview-${Date.now()}-${safeName}`;
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, contents, { encoding: 'utf8' });
  return vscode.Uri.file(filePath);
}

/**
 * Cleanup old preview temp files created by this extension.
 */
export async function cleanupOldPreviews() {
  try {
    const tempDir = path.join(os.tmpdir(), 'local-ai-assistant-previews');
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith('LocalAIAssistantPreview-')) {
        const fullPath = path.join(tempDir, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
            await fs.unlink(fullPath);
          }
        } catch {
          // ignore errors on individual files
        }
      }
    }
  } catch {
    // ignore if folder doesn’t exist
  }
}

/**
 * Handle an editFile message from the webview.
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

    const editsNorm = normalizeEdits(msg.edits, doc)
      .slice()
      .sort((a, b) => b.start.line - a.start.line);

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const e of editsNorm) {
      const start = new vscode.Position(e.start.line, 0);
      const end   = new vscode.Position(e.end.line, 0); // exclusive
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
 */
export async function handleRequestPreview(uri: string, edits: EditChange[], webview: vscode.Webview) {
  try {
    const vscodeUri = vscode.Uri.parse(uri);
    const doc = await vscode.workspace.openTextDocument(vscodeUri);
    const originalText = doc.getText();

    // Normalize edits before preview
    const editsNorm = normalizeEdits(edits, doc);

    const preview = generateEditPreview(editsNorm, originalText);
    const content = editsNorm.map(e => e.newText).join('\n');

    webview.postMessage({ type: 'editPreview', uri, content, edits: editsNorm, preview });

    // Optional: native VS Code diff view (uncomment to enable)
    // ...
  } catch (err) {
    webview.postMessage({
      type: 'editPreview',
      uri: String(uri ?? ''),
      content: '',
      edits,
      preview: `Error generating preview: ${String(err)}`
    });
  }
}

/**
 * Generate a human-readable preview of file edits.
 * Backend is 0-based exclusive, but display is 1-based inclusive.
 */
export function generateEditPreview(edits: EditChange[], docText?: string): string {
  if (!edits || edits.length === 0) return 'No changes to preview';
  const docLines = docText ? docText.split(/\r?\n/) : [];
  const lines: string[] = [];

  for (const [index, edit] of edits.entries()) {
    const startLine = edit.start.line; // 0-based
    const endExcl   = edit.end.line;   // exclusive
    const start1 = startLine + 1;
    const endIncl = endExcl - 1;       // last included line (0-based)
    const end1 = endIncl + 1;          // display as 1-based

    const range = endIncl === startLine
      ? `${start1}`
      : `${start1}-${end1}`;

    const before = docLines.length
      ? docLines.slice(startLine, endExcl) // exclusive end
          .map((l, i) => `${start1 + i}: ${l}`)
          .join('\n')
      : '(original text unavailable)';

    const afterLines = (edit.newText ?? '').replace(/\n$/, '').split(/\r?\n/);
    const after = afterLines
      .map((l, i) => `${start1 + i}: ${l}`)
      .join('\n');

    lines.push(
      `🔧 Edit ${index + 1} (lines ${range}):\n` +
      `--- Before ---\n${before}\n` +
      `--- After ---\n${after || '(deleted)'}`
    );
  }

  return lines.join('\n\n');
}
