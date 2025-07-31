import * as vscode from 'vscode';
import { registerChatPanelCommand } from './commands/chatPanel';
import { setupIdleTooltip } from './commands/idleTooltip';
import { registerCodeActions } from './commands/codeActions';
import { fetchAvailableModels } from './api/openaiProxy';

export function activate(context: vscode.ExtensionContext) {
  // Tooltip, panels, code-actions
  setupIdleTooltip(context);
  registerChatPanelCommand(context);
  registerCodeActions(context);

  // Custom commands
  registerSelectModelCommand(context);
  registerSetApiKeyCommand(context);

  // Status bar button to open chat
  createStatusBarItem(context);
}

export function deactivate() {
  // graceful shutdown if needed
}

// Adds the “Local AI Assistant” status-bar item.
function createStatusBarItem(context: vscode.ExtensionContext) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(robot) Local AI Assistant';
  item.tooltip = 'Open Local AI Chat';
  item.command = 'extension.openChatPanel';
  item.show();
  context.subscriptions.push(item);
}

// Let the user pick a model—no auto-fetch on activation.
function registerSelectModelCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('extension.selectModel', async () => {
    const models = await fetchAvailableModels();
    if (!models.length) {
      vscode.window.showErrorMessage(
        'Local AI Assistant: No local AI models available. Check your endpoint and authentication.'
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(models, {
      placeHolder: 'Select an LLM model for completions and chat',
    });

    if (picked) {
      await vscode.workspace
        .getConfiguration('localAIAssistant')
        .update('model', picked, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`✅ Model set to: ${picked}`);
    }
  });

  context.subscriptions.push(cmd);
}

// Securely prompt the user for an API key.
function registerSetApiKeyCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('extension.setApiKey', async () => {
    const key = await promptForApiKey();
    if (key) {
      await context.secrets.store('localAIAssistant.apiKey', key);
      vscode.window.showInformationMessage('API key saved securely.');
    }
  });

  context.subscriptions.push(cmd);
}

async function promptForApiKey(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Enter your API key',
    placeHolder: 'sk-…',
    password: true,
  });
}
