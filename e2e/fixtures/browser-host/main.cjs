// Test host for main's browser tabs (29 §5.1): Electron runs the real `browser.ts` (TypeScript loads as is in
// Electron's Node) with a local web server, and `browser-host.electron.spec.ts` drives it through
// `globalThis.harness`, standing in for the backend.
// CommonJS without top-level await: Playwright's Electron loader requires the main script.
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { app, BrowserWindow } = require('electron');
const { createBrowserTabs } = require('../../../apps/desktop/src/main/browser.ts');

const PAGE = `<!doctype html><title>host</title>
<button onclick="window.clicked = (window.clicked || 0) + 1">Go</button>
<input id="a" aria-label="first"><input id="b" aria-label="second">`;

const requests = [];
const server = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  res.writeHead(200, { 'content-type': req.url.startsWith('/api') ? 'application/json' : 'text/html' });
  res.end(req.url.startsWith('/api') ? '{}' : PAGE);
});
server.on('upgrade', (req, socket) => {
  requests.push(`UPGRADE ${req.url}`);
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
});

app.whenReady().then(() => server.listen(0, '127.0.0.1', start));

function start() {
  const origin = `http://127.0.0.1:${server.address().port}`;

  const events = [];
  const waiters = new Set();
  const record = (event) => {
    events.push(event);
    for (const waiter of waiters) if (waiter.matches(event)) waiter.resolve(event);
  };
  const tabs = createBrowserTabs({
    window: () => win,
    emit: record,
    // Recorded with the events, as `{ type: 'external', url }`.
    openExternal: (url) => record({ type: 'external', url }),
  });

  globalThis.harness = {
    origin,
    tabs,
    events,
    requests,
    /** The next event (from now) that `matches`, as the backend would await it. */
    next(matches) {
      return new Promise((resolve) => {
        const waiter = {
          matches,
          resolve: (event) => {
            waiters.delete(waiter);
            resolve(event);
          },
        };
        waiters.add(waiter);
      });
    },
  };
  // Created last: the spec starts once the window exists, and so the harness.
  const win = new BrowserWindow({ show: false, width: 1000, height: 700 });
  app.on('will-quit', () => tabs.closeAll());
  // A window counts for Playwright once it shows a page.
  void win.loadURL('about:blank');
}
