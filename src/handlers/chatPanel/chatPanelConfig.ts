// src/handlers/chatPanel/chatPanelConfig.ts
import * as vscode from 'vscode';

const CONFIG_SECTION = 'localAIAssistant';

export function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue);
}

export function getMaxContextTokens(): number {
  return getConfig<number>('context.contextSize', 4096);
}

export function sendInitialSettings(panel: vscode.WebviewPanel) {
  const initialUrl = (getConfig<string>('apiLLM.apiURL.endpoint', '')?.trim() || 'None');
  const initialApiType = (getConfig<string>('apiLLM.config.apiType', '')?.trim() || 'None');
  panel.webview.postMessage({ type: 'setLLMUrl', value: initialUrl });
  panel.webview.postMessage({ type: 'setApiType', value: initialApiType });
}

export async function updateApiStatus(panel: vscode.WebviewPanel) {
  const { checkServiceHealth, startHealthLoop, stopHealthLoop } = await import('../../api/apiRouter');
  const health = await checkServiceHealth();
  panel.webview.postMessage({ type: 'apiReachability', value: health });

  if (health.serviceUp && health.hasModels) {
    startHealthLoop(panel);
  } else {
    stopHealthLoop();
  }
}

export function watchConfigChanges(
  getPanel: () => vscode.WebviewPanel | undefined,
  updateApiStatusFn: (panel: vscode.WebviewPanel) => void
) {
  vscode.workspace.onDidChangeConfiguration((e) => {
    const panel = getPanel();
    if (!panel) return;

    const post = (type: string, val: any) => panel.webview.postMessage({ type, value: val });
    let shouldRecheck = false;

    if (e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.apiURL.endpoint`)) {
      post('setLLMUrl', getConfig<string>('apiLLM.apiURL.endpoint', '')?.trim() || 'None');
      shouldRecheck = true;
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.config.apiType`)) {
      post('setApiType', getConfig<string>('apiLLM.config.apiType', '')?.trim() || 'None');
      shouldRecheck = true;
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.context.contextSize`)) {
      post('contextSize', getMaxContextTokens());
    }
    if (e.affectsConfiguration(`${CONFIG_SECTION}.apiLLM.config.model`)) {
      post('setModel', getConfig<string>('apiLLM.config.model', '')?.trim() || 'None');
      shouldRecheck = true;
    }
    if (shouldRecheck) {
      updateApiStatusFn(panel);
    }
  });
}
