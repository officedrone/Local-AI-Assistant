import * as vscode from 'vscode';
import { registerChatPanelCommand } from './commands/chatPanel';
import { setupIdleTooltip } from './commands/idleTooltip';
import { registerCodeActions } from './commands/codeActions';
import { fetchAvailableModels } from './api/apiRouter';

const CONFIG_SECTION = 'localAIAssistant';

//quickPick helper for ApiType selector
type QuickPickOptionsWithActive<T extends vscode.QuickPickItem> =
vscode.QuickPickOptions & { activeItem?: T };

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
  registerSetApiUrlCommand(context);
  registerSelectApiTypeCommand(context);
  registerSetContextSizeCommand(context);
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

// “Set API URL” command
function registerSetApiUrlCommand(context: vscode.ExtensionContext) {
  const setApiUrlCmd = vscode.commands.registerCommand(
    'extension.setApiURL',
    async () => {
      const configKey = 'localAIAssistant.apiLLM.apiURL.endpoint';

      const current = vscode.workspace.getConfiguration().get<string>(configKey) ?? '';
      const value = await vscode.window.showInputBox({
        prompt: 'Enter the LLM endpoint URL',
        placeHolder: 'e.g. http://localhost:1234/v1 or http://localhost:11434/api',
        value: current,
        validateInput: (input) => {
          try {
            new URL(input);
            return null;
          } catch {
            return 'Please enter a valid URL (must include protocol)';
          }
        }
      });

      if (value && value.trim()) {
        await vscode.workspace.getConfiguration().update(
          configKey,
          value.trim(),
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(`✅ API URL set to: ${value.trim()}`);
      }
    }
  );
  context.subscriptions.push(setApiUrlCmd);
}

function registerSetContextSizeCommand(context: vscode.ExtensionContext) {
  const setContextSizeCmd = vscode.commands.registerCommand(
    'extension.setContextSize',
    async () => {
      const configKey = 'localAIAssistant.context.contextSize';

      const current = vscode.workspace.getConfiguration().get<number>(configKey) ?? 4096;

      const value = await vscode.window.showInputBox({
        prompt: 'Enter the Dontext size',
        placeHolder: 'e.g. 4096',
        value: current.toString(),
        validateInput: (input) => {
          return /^\d+$/.test(input) ? null : 'Please enter a valid number';
        }
      });

      if (value && /^\d+$/.test(value)) {
        const parsed = parseInt(value, 10);

        await vscode.workspace.getConfiguration().update(
          configKey,
          parsed,
          vscode.ConfigurationTarget.Global
        );

        vscode.window.showInformationMessage(`✅ Max token count set to: ${parsed}`);
      }
    }
  );

  context.subscriptions.push(setContextSizeCmd);
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

// "Select API Type" command
export function registerSelectApiTypeCommand(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    'extension.selectApiType',
    async () => {
      const cfg = vscode.workspace.getConfiguration(
        `${CONFIG_SECTION}.apiLLM.config`
      );

      // 1) Define your two options
      const apiTypes: readonly vscode.QuickPickItem[] = [
        { label: 'OpenAI' },
        { label: 'Ollama' }
      ];

      // 2) Figure out which one is currently selected
      const currentApiType = cfg.get<string>('apiType', 'OpenAI');
      const activeApiType = apiTypes.find(
        (t) => t.label.toLowerCase() === currentApiType.toLowerCase()
      );

      // 3) Build options with an optional activeItem
      const options: QuickPickOptionsWithActive<vscode.QuickPickItem> = {
        placeHolder: 'Select an API type',
        activeItem: activeApiType
      };

      // 4) Force the QuickPickItem overload
      const pickedItem = await vscode.window.showQuickPick<vscode.QuickPickItem>(
        apiTypes,
        options
      );

      // 5) Guard undefined and compare against the current
      if (pickedItem && pickedItem.label !== currentApiType) {
        await cfg.update(
          'apiType',
          pickedItem.label,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(
          `✅ API type set to: ${pickedItem.label}`
        );
      }
    }
  );

  context.subscriptions.push(cmd);
}


// Add to activate function after other register commands



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
