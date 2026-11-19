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

function freePort() {
  return new Promise((resolve, reject) => { const s = http.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

test('desktop server reuses the same port across restarts so page storage keeps one origin', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lsc-desktop-port-')); await writeFile(path.join(root, 'index.html'), 'ok');
  const api = async (req, res, next) => next();
  const port = await freePort();
  const first = createDesktopServer({ staticRoot: root, api });
  try { assert.equal(await first.listen([port]), port); } finally { await first.close(); }
  const second = createDesktopServer({ staticRoot: root, api });
  try { assert.equal(await second.listen([port]), port); } finally { await second.close(); }
});

test('desktop server moves to the next candidate when the preferred port is taken', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lsc-desktop-busy-')); await writeFile(path.join(root, 'index.html'), 'ok');
  const blocker = http.createServer(); await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const taken = blocker.address().port, spare = await freePort();
  const desktop = createDesktopServer({ staticRoot: root, api: async (req, res, next) => next() });
  try { assert.equal(await desktop.listen([taken, spare]), spare); } finally { await desktop.close(); await new Promise(resolve => blocker.close(resolve)); }
});

test('saved desktop port is read back first and invalid files fall back to the default range', async () => {
  const { portCandidates, readSavedPort, savePort, DEFAULT_PORTS } = await import('../desktop/port.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'lsc-desktop-saved-')), file = path.join(dir, 'desktop-port.json');
  assert.equal(await readSavedPort(file), null);
  await savePort(file, 43210);
  assert.equal(await readSavedPort(file), 43210);
  assert.deepEqual(portCandidates(43210).slice(0, 2), [43210, DEFAULT_PORTS[0]]);
  assert.equal(portCandidates(43210).filter(port => port === 43210).length, 1);
  await writeFile(file, '{"port":80}'); assert.equal(await readSavedPort(file), null);
  await writeFile(file, 'not json'); assert.equal(await readSavedPort(file), null);
  assert.deepEqual(portCandidates(null).slice(0, DEFAULT_PORTS.length), DEFAULT_PORTS);
  assert.equal(portCandidates(null).at(-1), 0, 'random port stays as a last resort so the app can still start');
});
