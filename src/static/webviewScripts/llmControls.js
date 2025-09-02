// llmControls.js
export function setupLLMControls(vscode) {
  document.getElementById('modelNameBox')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'invokeCommand', command: 'extension.selectModel' });
  });
  document.getElementById('llmURLBox')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'invokeCommand', command: 'extension.setApiURL' });
  });
  document.getElementById('apiTypeBox')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'invokeCommand', command: 'extension.selectApiType' });
  });
  document.getElementById('contextSizeBox')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'invokeCommand', command: 'extension.setContextSize' });
  });
  document.getElementById('refreshSvcBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshApiStatus' });
  });
}
