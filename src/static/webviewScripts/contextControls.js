// src/static/webviewScripts/contextControls.js

const contextList = document.getElementById('contextFileList'); // container in your HTML
let currentFiles = [];
let scopeCount = 0;

function calculateMasterState(files) {
  if (!files || files.length === 0) return 'smart';
  
  const allFull = files.every(f => f.sendFullFile === true);
  const allSmart = files.every(f => (f.sendFullFile ?? false) === false);
  
  if (allFull) return 'full';
  if (allSmart) return 'smart';
  return 'mixed';
}

function updateMasterToggleDisplay(state) {
  const btn = document.getElementById('masterModeToggle');
  if (!btn) return;
  
  if (state === 'smart') {
    btn.textContent = 'Smart Slices ↻';
  } else if (state === 'full') {
    btn.textContent = 'Full Files ↻';
  } else { // mixed - just show smart as default clickable option
    btn.textContent = 'Mixed Mode ↻';
  }
}

export function setupContextControls(vscode) {
  const masterModeToggle = document.getElementById('masterModeToggle');
  if (masterModeToggle) {
    masterModeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // Always send the opposite of current majority state, or smart if mixed
      const files = currentFiles;
      const fullCount = files.filter(f => f.sendFullFile === true).length;
      const smartCount = files.length - fullCount;
      
      const newMode = smartCount >= fullCount ? 'full' : 'smart';
      
      vscode.postMessage({ 
        type: 'setAllMode', 
        mode: newMode 
      });
    });
  }

  // Open settings link (optional element)
  document.getElementById('editContextLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({
      type: 'openSettings',
      key: 'localAIAssistant.context.contextSize'
    });
  });

  // Buttons for context
  document.getElementById('addCurrentBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'addCurrent' });
  });

  document.getElementById('addFileBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'pickAndAddFile' });
  });

  document.getElementById('addEditorsBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'addEditors' });
  });

  document.getElementById('clearContextBtn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearContext' });
  });

  // --- Drag & Drop support ---
  if (contextList) {
    contextList.addEventListener('dragover', (e) => {
      e.preventDefault();
      // apply drag-over to the inner list if present
      const inner = contextList.querySelector('.context-files-list');
      (inner || contextList).classList.add('drag-over');
    });

    contextList.addEventListener('dragleave', () => {
      const inner = contextList.querySelector('.context-files-list');
      (inner || contextList).classList.remove('drag-over');
    });

    contextList.addEventListener('drop', (e) => {
      e.preventDefault();
      const inner = contextList.querySelector('.context-files-list');
      (inner || contextList).classList.remove('drag-over');

      const items = e.dataTransfer?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              const uri = file.path ? `file://${file.path}` : undefined;
              if (uri) {
                vscode.postMessage({ type: 'addFileToContext', uri });
              }
            }
          }
        }
      }
    });
  }
  setupOutsideClickHandler();
}

// Update scope file count in header
export function updateScopeCount(count) {
  scopeCount = count;
  const scopeCountSpan = document.getElementById('scopeFileCount');
  if (scopeCountSpan) {
    scopeCountSpan.textContent = count.toString();
  }
}

function setupOutsideClickHandler() {
  document.addEventListener('click', (e) => {
    const details = document.querySelector('details.context-files-dropdown');
    if (!details) return;

    if (details.open && !details.contains(e.target)) {
      details.open = false;
    }
  });
}

export function updateContextFileList(vscode, files) {
  if (!contextList) return;

  const contextSize = Number(document.body.dataset.contextSize || '4096');

  // Update scope count display in header
  updateScopeCount(scopeCount);

  const prevDetails = contextList.querySelector('details.context-files-dropdown');
  const wasOpen = prevDetails?.open ?? false;

  contextList.innerHTML = '';

  if (!files || files.length === 0) {
    contextList.innerHTML = '<em>No files in scope</em>';
    return;
  }

  const makeEntry = (f, prefix = '') => {
    const entry = document.createElement('div');
    entry.className = 'context-file-entry';

    const left = document.createElement('span');
    left.className = 'file-info';

    const rawName = f.uri.split('/').pop() || f.uri;
    const displayName = decodeURIComponent(rawName);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'filename';
    nameSpan.textContent = prefix ? `${prefix}${displayName}` : displayName;

    left.appendChild(nameSpan);
    left.appendChild(
      document.createTextNode(` [${f.language}] (${f.tokens} tokens)`)
    );

    if (f.tokens > contextSize) {
      left.classList.add('context-over-limit');
    }

    const modeToggle = document.createElement('button');
    modeToggle.className = 'file-mode-cycle-btn';
    const isFull = f.sendFullFile ?? false;
    modeToggle.textContent = `${isFull ? 'Full File' : 'Smart Slice'} ↻`;
    modeToggle.title = `Click to toggle fetch mode: ${isFull ? 'Request specific line ranges (Smart Slice)' : 'Request full file content'}`;
    
    modeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ 
        type: 'toggleFileMode', 
        uri: f.uri,
        sendFullFile: !isFull
      });
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.className = 'remove-file-btn';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'removeFileFromContext', uri: f.uri });
    });

    entry.appendChild(left);
    entry.appendChild(modeToggle);
    entry.appendChild(removeBtn);
    return entry;
  };

  if (files.length === 1) {
    // Wrap single entry in a bordered list container
    const list = document.createElement('div');
    list.className = 'context-files-list single';

    const entry = makeEntry(files[0]);
    if (files[0].tokens > contextSize) {
      entry.querySelector('.file-info')?.classList.add('context-over-limit');
    }

    list.appendChild(entry);
    contextList.appendChild(list);
  } else {
    const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);

    const details = document.createElement('details');
    details.className = 'context-files-dropdown';
    details.open = wasOpen;

    const summary = document.createElement('summary');

    const summaryContent = document.createElement('span');
    summaryContent.className = 'context-summary-label';
    summaryContent.textContent = `(${files.length}) files`;

    if (totalTokens > contextSize) {
      summaryContent.classList.add('context-over-limit');
    }

    const removeAllBtn = document.createElement('button');
    removeAllBtn.textContent = '✕';
    removeAllBtn.className = 'remove-file-btn';
    removeAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'clearContext' });
    });

    summary.appendChild(summaryContent);
    summary.appendChild(removeAllBtn);

    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'context-files-list';

    files.forEach(f => list.appendChild(makeEntry(f)));

    details.appendChild(list);
    contextList.appendChild(details);
  }

  const state = calculateMasterState(files);
  updateMasterToggleDisplay(state);
  
  currentFiles = files;
}
