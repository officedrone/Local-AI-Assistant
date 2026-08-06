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
  // Update the Context section summary token count
  const summaryTokenCount = document.getElementById('contextSummaryTokenCount');
  if (summaryTokenCount) {
    summaryTokenCount.textContent = String(tokens);
    
    // Update color based on limit
    const summaryText = summaryTokenCount.parentElement;
    if (summaryText) {
      summaryText.style.color = tokens > contextSize ? 'orange' : '';
    }
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

// Update token count on specific bubble (for assistant bubbles only)
export function updateBubbleTokenCount(bubbleElem, tokens, tps = null) {
  if (!bubbleElem) return;
  
  let tokenDiv = bubbleElem.querySelector('.token-count');
  
  // Create if doesn't exist
  if (!tokenDiv) {
    const footer = bubbleElem.querySelector('.bubble-footer');
    if (footer) {
      tokenDiv = document.createElement('div');
      tokenDiv.className = 'token-count';
      footer.appendChild(tokenDiv);
    } else {
      // Fallback: create in markdown-body
      const body = bubbleElem.querySelector('.markdown-body');
      if (body) {
        tokenDiv = document.createElement('div');
        tokenDiv.className = 'token-count';
        body.appendChild(tokenDiv);
      }
    }
  }
  
  if (tokenDiv) {
    let displayText = `🧮 ${tokens} tokens`;
    if (typeof tps === 'number') {
      displayText += ` (${tps} TPS)`;
    }
    tokenDiv.textContent = displayText;
  }
}

// NEW: Clear token count from bubble when stream ends
export function clearBubbleTokenCount(bubbleElem) {
  if (!bubbleElem) return;
  
  const tokenDiv = bubbleElem.querySelector('.token-count');
  if (tokenDiv) {
    tokenDiv.textContent = '';
  }
}
