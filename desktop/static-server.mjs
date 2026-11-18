import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

export const desktopCSP = [
  "default-src 'self'", "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "media-src 'self' blob:", "font-src 'self' data:",
  "connect-src 'self' https:", "frame-src https://challenges.cloudflare.com",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function localFile(staticRoot, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const root = path.resolve(staticRoot), target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

async function serveStatic(req, res, staticRoot) {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  const target = localFile(staticRoot, pathname);
  if (!target) { res.writeHead(403); res.end('Forbidden'); return; }
  let info;
  try { info = await stat(target); } catch { res.writeHead(404); res.end('Not found'); return; }
  if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
  const headers = {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size, 'Content-Security-Policy': desktopCSP,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  };
  if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  headers['Cache-Control'] = path.basename(target) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  createReadStream(target).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
}

export function createDesktopServer({ api, staticRoot, onAuthCallback } = {}) {
  if (typeof api !== 'function') throw new TypeError('Desktop server requires the local API handler.');
  if (!staticRoot) throw new TypeError('Desktop server requires a static root.');
  const server = createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (pathname === '/auth/callback') onAuthCallback?.();
    if (pathname.startsWith('/api/') || pathname === '/auth/callback') return api(req, res, () => serveStatic(req, res, staticRoot));
    return serveStatic(req, res, staticRoot);
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
    }),
    close: () => new Promise(resolve => { if (!server.listening) return resolve(); server.close(() => resolve()); }),
  };
}
