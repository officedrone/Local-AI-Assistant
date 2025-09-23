// src/static/webviewScripts/sessionTokens.js

export function updateTokenPanel({ sessionTokens, fileContextTokens, totalTokens }, contextSize) {
  const sessionTokenSpan = document.getElementById('sessionTokenCount');
  const fileTokenSpan = document.getElementById('fileTokenCount');
  const totalSpan = document.getElementById('totalTokenCount');

  if (sessionTokenSpan) {
    sessionTokenSpan.textContent = String(sessionTokens);
  }

  // Always show the file context tokens (do not gate on includeCtxStatus)
  if (fileTokenSpan) {
    fileTokenSpan.textContent = String(fileContextTokens);
  }

  if (totalSpan) {
    totalSpan.textContent = String(totalTokens);
    totalSpan.style.color = totalTokens > contextSize ? 'orange' : '';
  }
}

export function updateFileContextTokens(tokens, contextSize) {
  // Update only the header count (live effective context)
  const contextTokenSpan = document.getElementById('contextTokenCount');
  if (contextTokenSpan) {
    contextTokenSpan.textContent = `(${tokens} tokens)`;
    contextTokenSpan.style.color = tokens > contextSize ? 'orange' : '';
  }


  // Adjust total color if needed
  const totalSpan = document.getElementById('totalTokenCount');
  if (totalSpan) {
    const total = parseInt(totalSpan.textContent || '0', 10);
    totalSpan.style.color = total > contextSize ? 'orange' : '';
  }
}


export function updateIncludeCtxStatus(isIncluded) {
  const el = document.getElementById('includeCtxStatus');
  if (el) {
    el.textContent = isIncluded ? 'true' : 'false';
  }
}
