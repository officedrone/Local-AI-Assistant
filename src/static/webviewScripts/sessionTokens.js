// /src/static/webviewScripts/sessionTokens.js
export function updateTokenPanel({ sessionTokens, fileContextTokens, totalTokens }, contextSize) {
  const sessionTokenSpan = document.getElementById('sessionTokenCount');
  const fileTokenSpan = document.getElementById('fileTokenCount');
  const totalSpan = document.getElementById('totalTokenCount');
  const includeFile = document.getElementById('contextCheckbox')?.checked;

  if (sessionTokenSpan) {
    sessionTokenSpan.textContent = String(sessionTokens);
  }

  if (fileTokenSpan) {
    fileTokenSpan.textContent = includeFile ? String(fileContextTokens) : '0';
  }

  if (totalSpan) {
    totalSpan.textContent = String(totalTokens);
    totalSpan.style.color = totalTokens > contextSize ? 'orange' : '';
  }
}
