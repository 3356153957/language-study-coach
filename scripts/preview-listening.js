// Isolated listening UI: no learner files, credentials, or AI calls.
import { createServer } from 'vite';
import { createEngine } from '../server/engine.js';
const now = new Date().toISOString();
const engine = createEngine({ initialState: { version: 1, config: null, profiles: {}, sessions: [{
  id: 'audio-qa', goal: '日常英语', mode: '听力', targetCount: 5, startedAt: now, currentAskedAt: now, history: [],
  current: { id: 'audio-question', kind: 'listening', skill: '听力', level: 'A2', reason: '隔离听力验收样例',
    prompt: 'When will the library open tomorrow?', passage: '',
    audio: 'The library usually opens at nine. Tomorrow it will open at ten because the staff have a meeting. Please use the side entrance. The main entrance is being repaired.',
    options: ['At nine', 'At ten', 'At eleven'], answer: 'At ten', hint: '注意 tomorrow 后的时间。' },
}] }, save: async () => { throw new Error('QA is read-only'); } });
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [{ name: 'listening-qa',
  configureServer(s) { s.middlewares.use((req, res, next) => {
    if (!req.url.startsWith('/api/')) return next();
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/api/state?')) return res.end(JSON.stringify(engine.view({ compact: true })));
    res.statusCode = 405; res.end(JSON.stringify({ error: '隔离试听页面仅用于播放，不保存答案。' }));
  }); },
  transformIndexHtml() { return [{ tag: 'div', attrs: { style: 'position:fixed;right:8px;top:4px;z-index:99;background:#fff1ce;font:11px sans-serif;padding:4px' }, children: '隔离试听 · 示例题目', injectTo: 'body-prepend' }]; },
}], server: { host: '127.0.0.1', port: 5182, strictPort: true, fs: { deny: ['**/.local/**', '.env', '.env.*'] } } });
await server.listen(); console.log('Isolated listening QA: http://127.0.0.1:5182/');
async function close() { await server.close(); process.exit(); }
process.once('SIGINT', close); process.once('SIGTERM', close);
