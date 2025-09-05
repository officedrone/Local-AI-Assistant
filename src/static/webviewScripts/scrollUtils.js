export let shouldAutoScroll = true;
export let userInitiatedScroll = false;

// Internal flag to ignore programmatic scroll events
let isProgrammaticScroll = false;
// Internal flag to throttle scrollToBottom calls
let scrollPending = false;

export function scrollToBottom(force = false, behavior = 'auto') {
  if (!force && !shouldAutoScroll) return;
  const chat = document.getElementById('chat-container');
  if (!chat) return;

  isProgrammaticScroll = true;
  chat.scrollTo({ top: chat.scrollHeight, behavior });
  isProgrammaticScroll = false;

  const btn = document.getElementById('scrollToBottomButton');
  if (btn) btn.style.display = 'none';
}

export function scrollToBottomImmediate(force = false) {
  scrollToBottom(force, 'auto');
}

// Throttled scroll for streaming updates
export function scheduleScrollToBottom() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollToBottomImmediate(true);
    scrollPending = false;
  });
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
  if (!chat) return;

  // Tight tolerance for auto‑scroll re‑engage
  const REENGAGE_THRESHOLD = 4; // px

  // Looser tolerance for showing the button, in lines
  const linesForButton = 5; // how many lines away before showing button
  const lineHeightPx = parseFloat(getComputedStyle(chat).lineHeight) || 20;
  const BUTTON_THRESHOLD = linesForButton * lineHeightPx;

  function distanceFromBottom() {
    return chat.scrollHeight - (chat.scrollTop + chat.clientHeight);
  }
  function atBottom() {
    return distanceFromBottom() <= REENGAGE_THRESHOLD;
  }
  function showButton() {
    return distanceFromBottom() > BUTTON_THRESHOLD;
  }

  // 1) Immediate disengage on first upward wheel tick
  chat.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY < 0) {
        userInitiatedScroll = true;
        shouldAutoScroll = false;
        if (scrollBtn) scrollBtn.style.display = 'block';
      }
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

  // 3) Mouse down — mark intent to scroll
  chat.addEventListener(
    'mousedown',
    () => {
      userInitiatedScroll = true;
    },
    { passive: true }
  );

  // 4) Scroll event: re‑engage only when within REENGAGE_THRESHOLD,
  //     but show/hide button using BUTTON_THRESHOLD
  chat.addEventListener(
    'scroll',
    () => {
      if (isProgrammaticScroll) return; // ignore our own scrolls

      if (atBottom()) {
        shouldAutoScroll = true;
        userInitiatedScroll = false;
        if (scrollBtn) scrollBtn.style.display = 'none';
      } else {
        if (scrollBtn) {
          scrollBtn.style.display = showButton() ? 'block' : 'none';
        }
        if (userInitiatedScroll) shouldAutoScroll = false;
      }
    },
    { passive: true }
  );

  // 5) Button: jump back and re‑enable
  if (scrollBtn) {
    scrollBtn.onclick = () => {
      shouldAutoScroll = true;
      userInitiatedScroll = false;
      scrollToBottom(true, 'smooth');
    };
  }
}
