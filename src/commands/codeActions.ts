import * as vscode from 'vscode';
import { buildChatMessages, getLanguage } from './promptBuilder';
import { getOrCreateChatPanel } from './chatPanel';
import { routeChatRequest } from '../api/apiRouter';
import encodingForModel from 'gpt-tokenizer';
import {
  countTextTokens,
  countMessageTokens,
  addToSessionTokenCount
} from './tokenActions';

const CONFIG_SECTION = 'localAIAssistant';

export const VALIDATE_CODE_ACTION    = 'extension.validateCodeAction';
export const COMPLETE_LINE_ACTION    = 'extension.completeCurrentLine';
export const COMPLETE_INLINE_COMMAND = 'extension.completeCodeInline';

// Utility to apply consistent indentation
function applyIndentation(text: string, indent: string): string {
  const normalized = text.replace(/^\s*/gm, ''); // strip leading whitespace
  return normalized
    .split('\n')
    .map(line => indent + line)
    .join('\n');
}

export function registerCodeActions(context: vscode.ExtensionContext) {
  // ——————————————————————————————————————————————————————————
  // 1) Validate Code Command
  // ——————————————————————————————————————————————————————————
  const validateCmd = vscode.commands.registerCommand(
    VALIDATE_CODE_ACTION,
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Open a file and select code to validate.');
        return;
      }

      const includeCtx = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>('includeFileContext', true);
      const fileContext = includeCtx ? editor.document.getText() : undefined;

      const sel = editor.selection;
      const code = sel.isEmpty
        ? editor.document.getText()
        : editor.document.getText(sel);

      const firstLine = sel.isEmpty
        ? editor.document.lineAt(0).text
        : editor.document.lineAt(sel.start.line).text;
      const leadingWhitespace = firstLine.match(/^\s*/)?.[0] ?? '';

      const language = await getLanguage();

      const messages = buildChatMessages({
        code,
        mode: 'validate',
        fileContext,
        language
      });

      const panel = getOrCreateChatPanel();

      const userMessage = messages.find(m => m.role === 'user')!;
      const tokenCount = countMessageTokens([userMessage]);
      addToSessionTokenCount(tokenCount);

      panel.webview.postMessage({
        type: 'appendUser',
        message: userMessage.content,
        tokens: tokenCount
      });

      console.log('=== Validating prompt payload ===');
      messages.forEach((m, i) => {
        const tokCount = encodingForModel.encode(m.content).length;
        console.log(`  [${i}] ${m.role.toUpperCase()}: ${tokCount} tokens`);
      });
      console.log('  TOTAL TOKENS (no padding):', messages
        .map(m => encodingForModel.encode(m.content).length)
        .reduce((a,b)=>a+b, 0)
      );
      console.log('  TOTAL TOKENS (with +4 padding each):', countMessageTokens(messages));
      console.log('================================');

      const response = await routeChatRequest({
        model: vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model')!,
        messages,
        panel
      });

      if (response) {
        const indented = applyIndentation(response, leadingWhitespace);

        editor.edit(editBuilder => {
          const insertPos = sel.isEmpty
            ? new vscode.Position(editor.document.lineCount, 0)
            : sel.end;
          editBuilder.insert(insertPos, '\n' + indented);
        });
      }
    }
  );

  // ——————————————————————————————————————————————————————————
  // 2) Complete Current Line Command
  // ——————————————————————————————————————————————————————————
  const completeCmd = vscode.commands.registerCommand(
    COMPLETE_LINE_ACTION,
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Open a file to use completion.');
        return;
      }

      const includeCtx = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>('includeFileContext', true);
      const fileContext = includeCtx ? editor.document.getText() : undefined;

      const sel = editor.selection;
      const lineText = editor.document.lineAt(sel.active.line).text;
      const leadingWhitespace = lineText.match(/^\s*/)?.[0] ?? '';

      const code = sel.isEmpty ? lineText : editor.document.getText(sel);
      const language = await getLanguage();

      const messages = buildChatMessages({
        code,
        mode: 'complete',
        fileContext,
        language
      });

      const panel = getOrCreateChatPanel();

      const userMessage = messages.find(m => m.role === 'user')!;
      const tokenCount = countMessageTokens([userMessage]);
      addToSessionTokenCount(tokenCount);

      panel.webview.postMessage({
        type: 'appendUser',
        message: userMessage.content,
        tokens: tokenCount
      });

      console.log('=== Validating prompt payload ===');
      messages.forEach((m, i) => {
        const tokCount = encodingForModel.encode(m.content).length;
        console.log(`  [${i}] ${m.role.toUpperCase()}: ${tokCount} tokens`);
      });
      console.log('  TOTAL TOKENS (no padding):', messages
        .map(m => encodingForModel.encode(m.content).length)
        .reduce((a,b)=>a+b, 0)
      );
      console.log('  TOTAL TOKENS (with +4 padding each):', countMessageTokens(messages));
      console.log('================================');

      const response = await routeChatRequest({
        model: vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model')!,
        messages,
        panel
      });

      if (response) {
        const indented = applyIndentation(response, leadingWhitespace);

        editor.edit(editBuilder => {
          const insertPos = sel.isEmpty
            ? editor.document.lineAt(sel.active.line).range.end
            : sel.end;
          editBuilder.insert(insertPos, '\n' + indented);
        });
      }
    }
  );

  context.subscriptions.push(validateCmd, completeCmd);
}
