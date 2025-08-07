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

      const language = await getLanguage();

      const messages = buildChatMessages({
        code,
        mode: 'validate',
        fileContext,
        language
      });

      const panel = getOrCreateChatPanel();

      // Grab the full user message object
      const userMessage = messages.find(m => m.role === 'user')!;

      // Count tokens and add to session total
      const tokenCount = countMessageTokens([userMessage]);
      addToSessionTokenCount(tokenCount);

      // Post user bubble to webview
      panel.webview.postMessage({
        type: 'appendUser',
        message: userMessage.content,
        tokens: tokenCount
      });

      await routeChatRequest({
        model: vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model')!,
        messages,
        panel
      });
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
      const code = sel.isEmpty
        ? editor.document.lineAt(sel.active.line).text
        : editor.document.getText(sel);

      const language = await getLanguage();

      const messages = buildChatMessages({
        code,
        mode: 'complete',
        fileContext,
        language
      });

      const panel = getOrCreateChatPanel();

      // Grab the full user message object
      const userMessage = messages.find(m => m.role === 'user')!;

      // Count tokens and add to session total
      const tokenCount = countMessageTokens([userMessage]);
      addToSessionTokenCount(tokenCount);

      // Post user bubble to webview
      panel.webview.postMessage({
        type: 'appendUser',
        message: userMessage.content,
        tokens: tokenCount
      });

      await routeChatRequest({
        model: vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>('model')!,
        messages,
        panel
      });
    }
  );

  context.subscriptions.push(validateCmd, completeCmd);
}
