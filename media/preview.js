(function () {
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'update':
        document.getElementById('preview-content').innerHTML = message.html;
        break;
    }
  });
})();
