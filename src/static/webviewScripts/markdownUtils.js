// markdownUtils.js
export const md = window.markdownit({ html: false, linkify: true, typographer: true });

export function renderMd(text) {
  return md.render(text);
}

export function injectLinks(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.dataset.linksInjected === '1') return;
    pre.dataset.linksInjected = '1';
    const codeText = pre.innerText;
    ['copy', 'insert'].forEach(label => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = label + '-link';
      a.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      a.dataset.code = codeText;
      pre.parentNode.insertBefore(a, pre);
    });
  });
}
