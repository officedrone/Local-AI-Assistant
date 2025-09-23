// src/static/webviewScripts/contextControls.js

const contextList = document.getElementById('contextFileList'); // container in your HTML

export function setupContextControls(vscode) {
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

// Update the token count text under the header
export function updateContextTokens(tokens, contextSize) {
  const span = document.getElementById('contextTokenCount');
  if (!span) return;
  const includeCtx = document.getElementById('includeCtxStatus')?.textContent === 'true';
  if (!includeCtx) {
    span.textContent = '(0 tokens)';
    span.style.color = '';
  } else {
    span.textContent = `(${tokens} tokens)`;
    span.style.color = tokens > contextSize ? 'red' : '';
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
  const prevDetails = contextList.querySelector('details.context-files-dropdown');
  const wasOpen = prevDetails?.open ?? false;

  contextList.innerHTML = '';

  if (!files || files.length === 0) {
    contextList.innerHTML = '<em>No files in context</em>';
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

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.className = 'remove-file-btn';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'removeFileFromContext', uri: f.uri });
    });

    entry.appendChild(left);
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
    summaryContent.textContent = `Files in context: (${files.length}) (${totalTokens} tokens)`;

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
}
