// Isolated slow/failing model fixture. Never reads or writes the user's data.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { createAPI } from '../server/api.js';
import { AppError } from '../server/providers.js';

const directory = await mkdtemp(path.join(tmpdir(), 'lsc-start-qa-'));
await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1, config: { provider: 'compatible', baseURL: 'https://fixture.invalid/v1', model: 'fixture', apiKey: 'test-only' }, profiles: {}, sessions: [] }));
let calls = 0;
const api = await createAPI({ directory, modelCall: async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 15000));
  if (calls === 1) throw new AppError('【隔离验收】模拟网络失败，请点击重新准备。', 502);
  return { kind: 'choice', skill: '语法', level: 'A2', prompt: 'Yesterday I ___ to the library.', passage: '', audio: '', options: ['go', 'went'], answer: 'went', hint: '注意 yesterday。', reason: '【隔离验收】测试慢请求、重试和自动进入题目。' };
} });
const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [{ name: 'start-qa', configureServer(server) { server.middlewares.use(api); } }], server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { deny: ['**/.local/**', '.env', '.env.*'] } } });
await vite.listen();
console.log('Isolated start QA: http://127.0.0.1:5174/; first request fails, second succeeds after 15s.');
async function stop() { await vite.close(); api.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
