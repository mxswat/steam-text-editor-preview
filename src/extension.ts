import * as vscode from 'vscode';
import * as path from 'path';
import { parseBBCode } from './bbcodeParser';

function getPreviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, bodyContent: string): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'preview.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'preview.js'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="preview-content">${bodyContent}</div>
  <script defer src="${scriptUri}"></script>
</body>
</html>`;
}

const previewPanels = new Set<vscode.WebviewPanel>();

function getWorkspaceRoots(): vscode.Uri[] {
  const roots: vscode.Uri[] = [];
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      roots.push(folder.uri);
    }
  }
  return roots;
}

function resolveImagePath(src: string, documentUri: vscode.Uri): vscode.Uri | null {
  if (/^https?:\/\//i.test(src)) return null;

  try {
    if (path.isAbsolute(src) || /^[a-zA-Z]:\\/.test(src)) {
      return vscode.Uri.file(src);
    }
    const docDir = vscode.Uri.joinPath(documentUri, '..');
    return vscode.Uri.joinPath(docDir, src);
  } catch {
    return null;
  }
}

function resolveImagePathsInHtml(html: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
  return html.replace(
    /(<img\s[^>]*?src\s*=\s*")([^"]+)("[^>]*?>)/gi,
    (_match, before, src, after) => {
      if (/^(https?:\/\/|vscode-webview-resource:\/\/)/i.test(src)) return _match;
      const resolved = resolveImagePath(src, documentUri);
      if (!resolved) return _match;
      const webviewUri = webview.asWebviewUri(resolved);
      return `${before}${webviewUri}${after}`;
    },
  );
}

function collectImageRoots(html: string, documentUri: vscode.Uri): vscode.Uri[] {
  const roots: vscode.Uri[] = [];
  const imgRegex = /<img\s[^>]*?src\s*=\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (/^https?:\/\//i.test(src)) continue;
    const resolved = resolveImagePath(src, documentUri);
    if (resolved) {
      const parent = vscode.Uri.joinPath(resolved, '..');
      if (!roots.some(r => r.toString() === parent.toString())) {
        roots.push(parent);
      }
    }
  }
  return roots;
}

function createPreviewPanel(context: vscode.ExtensionContext, documentUri: vscode.Uri): vscode.WebviewPanel {
  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn! + 1
    : vscode.ViewColumn.Beside;

  const resourceRoots: vscode.Uri[] = [
    vscode.Uri.joinPath(context.extensionUri, 'media'),
    ...getWorkspaceRoots(),
    vscode.Uri.joinPath(documentUri, '..'),
  ];

  const panel = vscode.window.createWebviewPanel(
    'steambb.preview',
    'Steam BBCode Preview',
    column,
    {
      enableScripts: true,
      localResourceRoots: resourceRoots,
      retainContextWhenHidden: true,
    },
  );

  previewPanels.add(panel);
  panel.onDidDispose(() => previewPanels.delete(panel));

  return panel;
}

function updateAllPreviews(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'steambb') return;

  const documentUri = editor.document.uri;
  const text = editor.document.getText();
  const parsedHtml = parseBBCode(text);

  for (const panel of previewPanels) {
    const htmlWithImages = resolveImagePathsInHtml(parsedHtml, documentUri, panel.webview);

    const extraRoots = collectImageRoots(parsedHtml, documentUri);
    if (extraRoots.length > 0) {
      const existing = panel.webview.options.localResourceRoots || [];
      const merged = [...existing];
      for (const root of extraRoots) {
        if (!merged.some(r => r.toString() === root.toString())) {
          merged.push(root);
        }
      }
      panel.webview.options = { ...panel.webview.options, localResourceRoots: merged };
    }

    panel.webview.html = getPreviewHtml(
      panel.webview,
      context.extensionUri,
      htmlWithImages,
    );
  }
}

let _context: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  _context = context;

  const previewCommand = vscode.commands.registerCommand('steambb.preview', () => {
    const documentUri = vscode.window.activeTextEditor?.document.uri;
    if (!documentUri) return;
    const panel = createPreviewPanel(context, documentUri);
    updateAllPreviews(context);

    const updateDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        updateAllPreviews(context);
      }
    });

    const changeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
      updateAllPreviews(context);
    });

    const closeDisposable = panel.onDidDispose(() => {
      updateDisposable.dispose();
      changeEditorDisposable.dispose();
    });

    context.subscriptions.push(updateDisposable, changeEditorDisposable, closeDisposable);
  });

  context.subscriptions.push(previewCommand);
}

export function deactivate() {}
