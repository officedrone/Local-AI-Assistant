// src/commands/codeActions.ts
import * as vscode from 'vscode';
import {
  buildOpenAIMessages,
  buildOllamaMessages,
  getLanguage,
  PromptContext
} from './promptBuilder';
import { getOrCreateChatPanel } from './chatPanel';
import { routeChatRequest } from '../api/apiRouter';
import encodingForModel from 'gpt-tokenizer';
import {
  countMessageTokens,
  addToSessionTokenCount,
  setStreamingActive
} from './tokenActions';

const CONFIG_SECTION = 'localAIAssistant';

export const VALIDATE_CODE_ACTION    = 'extension.validateCodeAction';
export const COMPLETE_LINE_ACTION    = 'extension.completeCurrentLine';
export const COMPLETE_INLINE_COMMAND = 'extension.completeCodeInline';

function applyIndentation(text: string, indent: string): string {
  const normalized = text.replace(/^\s*/gm, '');
  return normalized
    .split('\n')
    .map(line => indent + line)
    .join('\n');
}

export function registerCodeActions(context: vscode.ExtensionContext) {
  // --- VALIDATE ---
  const validateCmd = vscode.commands.registerCommand(
    VALIDATE_CODE_ACTION,
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Open a file and select code to validate.');
        return;
      }

      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const includeCtx = config.get<boolean>('context.includeFileContext', true);
      const apiType = config.get<string>('apiType', 'openai');
      const model = config.get<string>('model')!;
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

      const promptContext: PromptContext = {
        code,
        mode: 'validate',
        fileContext,
        language
      };

      const messages = apiType === 'ollama'
        ? buildOllamaMessages(promptContext)
        : buildOpenAIMessages(promptContext);

      const panel = getOrCreateChatPanel();
      setStreamingActive(panel, true);

      try {
        // Count and display user tokens
        const userMessage = messages.find(m => m.role === 'user')!;
        const promptTokenCount = countMessageTokens([userMessage]);
        addToSessionTokenCount(promptTokenCount);

        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage.content,
          tokens: promptTokenCount
        });

        // Track full assistant text and token counts
        let assistantText = '';
        let lastFullCount = 0;

        const onToken = (chunk: string) => {
          assistantText += chunk;

          // Re-encode full assistantText to compute actual new tokens
          const fullCount = encodingForModel.encode(assistantText).length;
          const delta = fullCount - lastFullCount;
          lastFullCount = fullCount;

          // Update session token count by delta
          addToSessionTokenCount(delta);

          // Send updated total tokens for this bubble
          panel.webview.postMessage({
            type: 'tokenUpdate',
            tokens: fullCount
          });
        };

        const onDone = () => {
          console.log(`✅ Assistant response token count: ${lastFullCount}`);
        };

        await routeChatRequest({
          model,
          messages,
          panel,
          onToken,
          onDone
        });
      } finally {
        setStreamingActive(panel, false);
      }
    }
  );

  // --- COMPLETE CURRENT LINE ---
  const completeCmd = vscode.commands.registerCommand(
    COMPLETE_LINE_ACTION,
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Open a file to use completion.');
        return;
      }

      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const includeCtx = config.get<boolean>('context.includeFileContext', true);

      const apiType = config.get<string>('apiType', 'openai');
      const model = config.get<string>('model')!;
      const fileContext = includeCtx ? editor.document.getText() : undefined;

      const sel = editor.selection;
      const lineText = editor.document.lineAt(sel.active.line).text;
      const leadingWhitespace = lineText.match(/^\s*/)?.[0] ?? '';

      const code = sel.isEmpty ? lineText : editor.document.getText(sel);
      const language = await getLanguage();

      const promptContext: PromptContext = {
        code,
        mode: 'complete',
        fileContext,
        language
      };

      const messages = apiType === 'ollama'
        ? buildOllamaMessages(promptContext)
        : buildOpenAIMessages(promptContext);

      const panel = getOrCreateChatPanel();
      setStreamingActive(panel, true);

      try {
        // Count and display user tokens
        const userMessage = messages.find(m => m.role === 'user')!;
        const promptTokenCount = countMessageTokens([userMessage]);
        addToSessionTokenCount(promptTokenCount);

        panel.webview.postMessage({
          type: 'appendUser',
          message: userMessage.content,
          tokens: promptTokenCount
        });

        // Track full assistant text and token counts
        let assistantText = '';
        let lastFullCount = 0;

        const onToken = (chunk: string) => {
          assistantText += chunk;

          const fullCount = encodingForModel.encode(assistantText).length;
          const delta = fullCount - lastFullCount;
          lastFullCount = fullCount;

          addToSessionTokenCount(delta);

          panel.webview.postMessage({
            type: 'tokenUpdate',
            tokens: fullCount
          });
        };

        const onDone = () => {
          console.log(`✅ Assistant response token count: ${lastFullCount}`);
        };

        await routeChatRequest({
          model,
          messages,
          panel,
          onToken,
          onDone
        });
      } finally {
        setStreamingActive(panel, false);
      }
    }
  );

  context.subscriptions.push(validateCmd, completeCmd);
}
