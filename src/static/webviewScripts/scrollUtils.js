// /src/static/webviewScripts/scrollUtils.js
export let shouldAutoScroll = true;
export let userInitiatedScroll = false;

export function scrollToBottom(force = false, behavior = 'auto') {
  if (!force && !shouldAutoScroll) return;
  const chat = document.getElementById('chat-container');
  chat.scrollTo({ top: chat.scrollHeight, behavior });
  const btn = document.getElementById('scrollToBottomButton');
  if (btn) btn.style.display = 'none';
}

export function scrollToBottomImmediate(force = false) {
  scrollToBottom(force, 'auto');
}

// Optional helpers if other modules want to adjust state
export function setAutoScrollEnabled(val) {
  shouldAutoScroll = !!val;
}
export function setUserInitiatedScroll(val) {
  userInitiatedScroll = !!val;
}

export function setupScrollHandling() {
  const chat = document.getElementById('chat-container');
  const scrollBtn = document.getElementById('scrollToBottomButton');

  // Re‑engage only when truly at bottom; small tolerance to avoid flicker
  const REENGAGE_THRESHOLD = 4; // px from absolute bottom

  function distanceFromBottom() {
    return chat.scrollHeight - (chat.scrollTop + chat.clientHeight);
  }
  function atBottom() {
    return distanceFromBottom() <= REENGAGE_THRESHOLD;
  }

  // 1) Immediate disengage on first upward wheel tick
  chat.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY < 0) {
        // User scrolled up one notch: disengage now
        userInitiatedScroll = true;
        shouldAutoScroll = false;
        if (scrollBtn) scrollBtn.style.display = 'block';
      }
      // Scrolling down won't auto‑reengage; that happens only when truly at bottom
    },
    { passive: true }
  );

  // 2) Touch and drag scenarios — disengage as soon as user moves and is away from bottom
  chat.addEventListener(
    'touchmove',
    () => {
      userInitiatedScroll = true;
      if (!atBottom()) {
        shouldAutoScroll = false;
        if (scrollBtn) scrollBtn.style.display = 'block';
      }
    },
    { passive: true }
  );

  chat.addEventListener(
    'mousedown',
    () => {
      // Mark intent; the next scroll event will handle the actual disengage if away from bottom
      userInitiatedScroll = true;
    },
    { passive: true }
  );

  // 3) Scroll event: only re‑engage when we’re truly at the bottom
  chat.addEventListener(
    'scroll',
    () => {
      if (atBottom()) {
        shouldAutoScroll = true;
        userInitiatedScroll = false;
        if (scrollBtn) scrollBtn.style.display = 'none';
      } else {
        if (scrollBtn) scrollBtn.style.display = 'block';
        // If the user is interacting, keep auto‑scroll off until they return to bottom
        if (userInitiatedScroll) shouldAutoScroll = false;
      }
    },
    { passive: true }
  );

  // 4) Button: jump back and re‑enable
  if (scrollBtn) {
    scrollBtn.onclick = () => {
      shouldAutoScroll = true;
      userInitiatedScroll = false;
      scrollToBottom(true, 'smooth');
    };
  }
}
