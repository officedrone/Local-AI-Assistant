import * as vscode from 'vscode';

const CONFIG = {
  section: 'localAIAssistant',
  idleKey: 'idleTooltipDelay',
  clearKey: 'tooltipClearDelay',
  enableTooltipKey: 'enableExtensionTooltip'
};

let idleTimer: NodeJS.Timeout;
let clearTimer: NodeJS.Timeout;
let tooltipVisible = false;
let hoverPosition: vscode.Position | null = null;

export function setupIdleTooltip(context: vscode.ExtensionContext) {
  const hoverProvider = vscode.languages.registerHoverProvider('*', {
    provideHover(doc, pos) {
      if (tooltipVisible && hoverPosition?.isEqual(pos)) {
        const md = new vscode.MarkdownString(
          '[Complete Code](command:extension.completeCurrentLine)' +
          ' | ' +
          '[Validate Code](command:extension.validateCodeAction)' +
          ' | ' +
          '[$(gear)](command:extension.openSettingsPanel)' + 
          ' | ' +
          '[$(eye-closed)](command:extension.disableIdleTooltip)'

        );
        md.isTrusted = true;
        md.supportThemeIcons = true;
        return new vscode.Hover(md, new vscode.Range(pos, pos));
      }
      return undefined;
    }
  });
  context.subscriptions.push(hoverProvider);

  function scheduleShow() {
    const cfg = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = cfg.get<boolean>(CONFIG.enableTooltipKey, true);
    if (!enabled) {
      // don't show tooltip if disabled
      return;
    }

    const idleDelay = cfg.get<number>(CONFIG.idleKey, 1500);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        tooltipVisible = false;
        return;
      }

      // set tooltip position and show
      hoverPosition = editor.selection.active;
      tooltipVisible = true;
      vscode.commands.executeCommand('editor.action.showHover');
      const clearDelay = cfg.get<number>(CONFIG.clearKey, 4000);
      clearTimeout(clearTimer);
      clearTimer = setTimeout(hideTooltip, clearDelay);
    }, idleDelay);
  }

  function hideTooltip() {
    if (!tooltipVisible) {
      return;
    }
    // reset visibility and position
    tooltipVisible = false;
    hoverPosition = null;
  }

  function reset() {
    // clear any pending timers & tooltip
    clearTimeout(idleTimer);
    clearTimeout(clearTimer);
    hideTooltip();
    
    // only re-schedule if tooltip is enabled
    const enabled = vscode.workspace
      .getConfiguration(CONFIG.section)
      .get<boolean>(CONFIG.enableTooltipKey, true);
    if (enabled) {
      scheduleShow();
    }
  }

  // fire reset on edits, selection changes, editor switches
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(reset),
    vscode.window.onDidChangeTextEditorSelection(reset),
    vscode.window.onDidChangeActiveTextEditor(reset),
    {
      dispose: () => {
        // cleanup on dispose
        clearTimeout(idleTimer);
        clearTimeout(clearTimer);
      }
    }
  );

  // open settings panel command
  const openSettingsCmd = vscode.commands.registerCommand(
    'extension.openSettingsPanel',
    async () => {
      clearTimeout(clearTimer);
      hideTooltip();
      await vscode.commands.executeCommand('extension.openChatPanel');
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:officedrone.local-ai-assistant'
      );
    }
  );
  context.subscriptions.push(openSettingsCmd);

  // disable tooltip command
  const disableTooltipCmd = vscode.commands.registerCommand(
    'extension.disableIdleTooltip',
    async () => {
      await vscode.workspace.getConfiguration(CONFIG.section)
        .update(CONFIG.enableTooltipKey, false, vscode.ConfigurationTarget.Global);

      hideTooltip();
      vscode.window.showInformationMessage('Idle Tooltip has been disabled.You can re-enable it in Settings');
    }
  );
  context.subscriptions.push(disableTooltipCmd);

  // kick off the first schedule
  reset();
}
