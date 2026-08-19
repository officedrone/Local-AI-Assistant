// src/static/webviewScripts/sessionTokens.js

// Track floating ping elements per element to limit to 3 max
const activePings = new Map();

export function triggerPingAnimation(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  // Get parent container (.tokenItem) for positioning reference
  const parent = element.parentElement;
  if (!parent) return;
  
  // Limit to 3 pings per element at a time (track by elementId)
  const maxPings = 3;
  let pingCount = activePings.get(elementId) || 0;
  
  if (pingCount >= maxPings) {
    // Remove oldest ping to make room
    const allFloats = parent.querySelectorAll('.token-ping-float');
    if (allFloats.length > 0) {
      allFloats[0].remove();
      pingCount--;
    }
  }
  
  // Create floating ping element
  const pingEl = document.createElement('span');
  pingEl.className = 'token-ping-float';
  pingEl.textContent = element.textContent;
  
  // Append first so we can measure its width
  parent.appendChild(pingEl);
  
  // Calculate correct horizontal position - center the float above the number
  const leftOffset = element.offsetLeft + (element.offsetWidth / 2) - (pingEl.offsetWidth / 2);
  
  // Style the floating number with correct positioning
  Object.assign(pingEl.style, {
    position: 'absolute',
    top: '-5px',
    left: `${leftOffset}px`
  });
  
  // Animate using Web Animations API (only vertical movement)
  pingEl.animate([
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(-15px)' }
  ], {
    duration: 500,
    easing: 'ease-out',
    fill: 'forwards'
  });
  
  // Track and cleanup
  pingCount++;
  activePings.set(elementId, pingCount);
  
  setTimeout(() => {
    pingEl.remove();
    const currentCount = activePings.get(elementId) || 0;
    activePings.set(elementId, Math.max(0, currentCount - 1));
  }, 500);
}

function flashTokenElement(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  // Remove class first to force animation restart
  element.classList.remove('token-green-flash');
  
  // Force reflow to restart animation
  void element.offsetWidth;
  
  // Add flash class
  element.classList.add('token-green-flash');
  
  // Remove after animation completes
  setTimeout(() => {
    element.classList.remove('token-green-flash');
  }, 300);
}

export function updateTokenPanel({ sessionTokens, fileContextTokens, toolsTokens, totalTokens }, contextSize) {
  const sessionTokenSpan = document.getElementById('sessionTokenCount');
  const fileTokenSpan = document.getElementById('fileTokenCount');
  const toolsTokenSpan = document.getElementById('toolsTokenCount');
  const totalSpan = document.getElementById('totalTokenCount');

  if (sessionTokenSpan) {
    const prevValue = parseInt(sessionTokenSpan.textContent || '0', 10);
    
    // Update text first, then trigger animation
    sessionTokenSpan.textContent = String(sessionTokens);
    
    // Trigger Mario coin animation and green flash if tokens increased
    if (sessionTokens > prevValue && sessionTokens !== 0) {
      triggerPingAnimation('sessionTokenCount');
      flashTokenElement('sessionTokenCount');
    }
  }

  // Always show the file context tokens (do not gate on includeCtxStatus)
  if (fileTokenSpan) {
    const prevFileValue = parseInt(fileTokenSpan.textContent || '0', 10);
    fileTokenSpan.textContent = String(fileContextTokens);
    
    if (fileContextTokens > prevFileValue && fileContextTokens !== 0) {
      triggerPingAnimation('fileTokenCount');
      flashTokenElement('fileTokenCount');
    }
  }

  // Update Tools token count
  if (toolsTokenSpan) {
    const prevToolsValue = parseInt(toolsTokenSpan.textContent || '0', 10);
    toolsTokenSpan.textContent = String(toolsTokens || 0);
    
    if ((toolsTokens || 0) > prevToolsValue && toolsTokens !== 0) {
      triggerPingAnimation('toolsTokenCount');
      flashTokenElement('toolsTokenCount');
    }
  }

  if (totalSpan) {
    const prevTotalValue = parseInt(totalSpan.textContent || '0', 10);
    totalSpan.textContent = String(totalTokens);
    totalSpan.style.color = totalTokens > contextSize ? 'orange' : '';
    
    if (totalTokens > prevTotalValue && totalTokens !== 0) {
      triggerPingAnimation('totalTokenCount');
      flashTokenElement('totalTokenCount');
    }
  }
}

export function updateFileContextTokens(data, contextSize) {
  // Accept either old format (tokens number) or new format ({ scopeTokens, sentTokens })
  let scopeTokens, sentTokens;
  
  if (typeof data === 'object' && data !== null) {
    // New format with dual token display
    scopeTokens = data.scopeTokens || 0;
    sentTokens = data.sentTokens || 0;
  } else {
    // Legacy format - treat as scope tokens for backward compatibility
    scopeTokens = typeof data === 'number' ? data : 0;
    sentTokens = 0;
  }

  // Update the File Context header with dual token display
  const scopeTokenSpan = document.getElementById('scopeTokenCount');
  if (scopeTokenSpan) {
    scopeTokenSpan.textContent = String(scopeTokens);
  }

  const sentTokenSpan = document.getElementById('sentTokenCount');
  if (sentTokenSpan) {
    sentTokenSpan.textContent = String(sentTokens);
    
    // Update color based on sent tokens vs context size
    const summaryText = sentTokenSpan.closest('.context-section-dropdown')?.querySelector('summary');
    if (summaryText) {
      summaryText.style.color = sentTokens > contextSize ? 'orange' : '';
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
