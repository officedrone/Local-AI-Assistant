// contextControls.js
export const contextCheckbox = document.getElementById('contextCheckbox');

export function getContextState() {
  return contextCheckbox?.checked ?? false;
}

export function setupContextControls(vscode) {
  contextCheckbox?.addEventListener('change', () => {
    vscode.postMessage({
      type: 'toggleIncludeFileContext',
      value: getContextState()
    });
  });

  document.getElementById('editContextLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({
      type: 'openSettings',
      key: 'localAIAssistant.context.contextSize'
    });
  });
}

export function updateContextTokens(tokens, contextSize) {
  const span = document.getElementById('contextTokenCount');
  if (!span) return;
  if (!getContextState()) {
    span.textContent = '(0 tokens)';
    span.style.color = '';
  } else {
    span.textContent = `(${tokens} tokens)`;
    span.style.color = tokens > contextSize ? 'red' : '';
  }
}
