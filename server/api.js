import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError, callModel } from './providers.js';
import { CodexBridge } from './codex.js';
import { createEngine } from './engine.js';

export async function createAPI({ directory, modelCall, codex = new CodexBridge({ directory }) } = {}) {
  modelCall ||= (config, system, context) => config?.provider === 'codex' ? codex.complete(config, system, context) : callModel(config, system, context);
  const file = path.join(directory, 'state.json');
  let state = { version: 1, config: null, profiles: {}, sessions: [] };
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('学习数据无法读取，请保留 .local/state.json 并检查文件。'); }
  let busy = false;
  const engine = createEngine({ initialState: state, modelCall, codex, save: async draft => {
    await mkdir(directory, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(draft, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }});
  const api = async function (req, res, nextHandler) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const viewOptions = { compact: url.searchParams.get('compact') === '1', timeZone: url.searchParams.get('tz') || 'UTC' };
    if (!route.startsWith('/api/')) return nextHandler();
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    let ownsLock = false;
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError('此版本仅允许从本机访问。', 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) throw new AppError('不允许跨站访问学习数据。', 403);
      if (req.method === 'GET' && route === '/api/state') return send(200, engine.view(viewOptions));
      if (req.method === 'GET' && route === '/api/session/detail') return send(200, engine.detail(url.searchParams.get('id')));
      if (req.method === 'GET' && route === '/api/profile') return send(200, engine.profile());
      if (req.method === 'GET' && route === '/api/activity') return send(200, engine.activity(url.searchParams.get('offset')));
      if (req.method === 'GET' && route === '/api/review') return send(200, engine.review(url.searchParams.get('goal'), url.searchParams.get('offset')));
      if (req.method === 'GET' && route === '/api/codex/status') return send(200, await codex.status());
      if (req.method !== 'POST') throw new AppError('请求方法不支持。', 405);
      if (req.headers['x-coach-request'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) throw new AppError('请求来源或格式不正确。', 403);
      if (busy) throw new AppError('正在处理上一项请求，请稍后重试。', 409);
      busy = true; ownsLock = true;
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new AppError('请求内容过长。', 413); }
      let input;
      try { input = JSON.parse(raw); } catch { throw new AppError('请求不是有效 JSON。'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('请求格式不正确。');
      if (route === '/api/codex/login') return send(200, await codex.loginStart(input.type));
      if (route === '/api/codex/login/cancel') { await codex.cancelLogin(); return send(200, await codex.status()); }
      send(200, await engine.execute(route, input, viewOptions));
    } catch (error) {
      send(error.status || 500, { error: error instanceof AppError ? error.message : '本地服务处理失败，数据未更新，请检查磁盘空间后重试。' });
    } finally { if (ownsLock) busy = false; }
  };
  api.close = () => codex.close();
  return api;
}
