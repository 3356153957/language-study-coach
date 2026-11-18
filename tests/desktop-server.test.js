import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createDesktopServer, desktopCSP } from '../desktop/static-server.mjs';

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); });
    req.on('error', reject); req.end();
  });
}

test('desktop loopback server serves only the packaged UI and delegates API routes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lsc-desktop-'));
  await writeFile(path.join(root, 'index.html'), '<main>desktop</main>'); await writeFile(path.join(root, 'app.js'), 'console.log(1)');
  const calls = [];
  const desktop = createDesktopServer({ staticRoot: root, api: async (req, res, next) => { calls.push(req.url); if (req.url === '/api/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); } else next(); } });
  const port = await desktop.listen();
  try {
    const [page, asset, api, traversal, method] = await Promise.all([request(port, '/'), request(port, '/app.js'), request(port, '/api/ping'), request(port, '/..%2fpackage.json'), request(port, '/', 'POST')]);
    assert.equal(page.status, 200); assert.match(page.body, /desktop/); assert.equal(page.headers['content-security-policy'], desktopCSP);
    assert.equal(asset.headers['content-type'], 'text/javascript; charset=utf-8'); assert.equal(api.body, '{"ok":true}'); assert.equal(traversal.status, 403); assert.equal(method.status, 405); assert.deepEqual(calls, ['/api/ping']);
  } finally { await desktop.close(); }
});

test('desktop callback can bring an external authorization back to the app', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lsc-desktop-callback-')); await writeFile(path.join(root, 'index.html'), 'ok'); let callbacks = 0;
  const desktop = createDesktopServer({ staticRoot: root, onAuthCallback: () => callbacks++, api: async (req, res, next) => { if (req.url.startsWith('/auth/callback')) { res.writeHead(200); res.end('callback'); } else next(); } });
  const port = await desktop.listen();
  try { const response = await request(port, '/auth/callback?code=test'); assert.equal(response.status, 200); assert.equal(callbacks, 1); } finally { await desktop.close(); }
});
