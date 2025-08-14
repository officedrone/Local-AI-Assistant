import * as vscode from 'vscode';
import { registerChatPanelCommand } from './commands/chatPanel';
import { setupIdleTooltip } from './commands/idleTooltip';
import { registerCodeActions } from './commands/codeActions';
import { fetchAvailableModels } from './api/apiRouter';

const CONFIG_SECTION = 'localAIAssistant';

export function activate(context: vscode.ExtensionContext) {
  
  
  // Read the initial apiType
  let lastApiType = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('apiLLM.config.apiType', '');


  // 1) Initialize core features
  setupIdleTooltip(context);
  registerChatPanelCommand(context);
  registerCodeActions(context);
  registerSelectModelCommand(context);
  registerSetApiKeyCommand(context);
  createStatusBarItem(context);


  // 2) Watch for apiType changes and clear model wherever it was set
  const onConfigChange = vscode.workspace.onDidChangeConfiguration(async (event) => {
    // Did the user change apiType?
    if (event.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.config.apiType`)) {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const newApiType = config.get<string>('apiLLM.config.apiType', '');

      // If it really changed, clear out any stored model
      if (lastApiType !== newApiType) {
        const inspect = config.inspect<string>('apiLLM.config.model');
        if (inspect) {
          // Clear global
          if (inspect.globalValue) {
            await config.update(
              'apiLLM.config.model',
              '',
              vscode.ConfigurationTarget.Global
            );
          }
          // Clear workspace
          if (inspect.workspaceValue) {
            await config.update(
              'apiLLM.config.model',
              '',
              vscode.ConfigurationTarget.Workspace
            );
          }
          // Clear workspace-folder
          if (inspect.workspaceFolderValue) {
            await config.update(
              'apiLLM.config.model',
              '',
              vscode.ConfigurationTarget.WorkspaceFolder
            );
          }
          vscode.window.showInformationMessage(
            `API switched "${lastApiType}"->"${newApiType}". Clearing stored model field. Use CTRL+SHIFT+ALT+M (CMD+SHIFT+ALT+M on MAC) to select a new model once you have populated the new URL and API type`
          );
        }
        lastApiType = newApiType;
      }
    }
  });

  context.subscriptions.push(onConfigChange);
}

export function deactivate() {
  // no-op
}


// Status bar helper

function createStatusBarItem(context: vscode.ExtensionContext) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.text = '$(robot) Local AI Assistant';
  item.tooltip = 'Open Local AI Chat';
  item.command = 'extension.openChatPanel';
  item.show();
  context.subscriptions.push(item);
}

// “Select Model” command

function registerSelectModelCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    'extension.selectModel',
    async () => {
      const cfg = vscode.workspace.getConfiguration(
        `${CONFIG_SECTION}.apiLLM.config`
      );
      const apiTypeRaw = cfg.get<string>('apiType', 'OpenAI');
      const apiType = apiTypeRaw.toLowerCase();

      const models = await fetchAvailableModels();
      if (!models.length) {
        vscode.window.showErrorMessage(
          `No ${apiType} models available. Check your endpoint/auth.`
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: `Select a ${apiType} model to use`,
      });
      if (picked) {
        await cfg.update('model', picked, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `✅ ${apiType} model set to: ${picked}`
        );
      }
    }
  );

  context.subscriptions.push(cmd);
}


// “Set API Key” command
function registerSetApiKeyCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    'extension.setApiKey',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your API key',
        password: true,
      });
      if (key) {
        // store under secrets for this extension
        await context.secrets.store(
          'localAIAssistant.apiLLM.config.apiKey',
          key
        );
        vscode.window.showInformationMessage('🔐 API key saved securely.');
      }
    }
  );
  context.subscriptions.push(cmd);
}
