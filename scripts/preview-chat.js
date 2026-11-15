// Isolated chat acceptance environment. Real coaching calls use the signed-in
// Codex account; no answers or follow-ups are written to the learner's data.
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { createAPI } from '../server/api.js';
import { CodexBridge } from '../server/codex.js';
import { prompts } from '../server/coach.js';

const root = process.cwd(), directory = await mkdtemp(path.join(tmpdir(), 'lsc-chat-qa-'));
const formal = JSON.parse(await readFile(path.join(root, '.local/state.json'), 'utf8'));
const task = { id: randomUUID(), kind: 'conversation', skill: '表达', level: 'A2', reason: '验收样例：根据自己的意思谈做饭前的准备。',
  prompt: 'What had you already done before you began making the food?\n请用一句完整的英语回答，说明开始做饭前已经完成的一项准备。', passage: '', audio: '', options: [],
  answer: 'I had already washed the vegetables.', hint: '可以用 had + 过去分词。' };
const now = Date.now();
const entry = { id: randomUUID(), task, answer: 'I was prerary the dish on the desk', feedback: { correct: false, explanation: '原批改理解为准备菜肴，需要进一步澄清用户的原意。', suggestion: 'I had prepared the dish on the desk.', weakness: '时态和具体词义' },
  activeSeconds: 15, hintUsed: false, replays: 0, transcriptViewed: false, askedAt: new Date(now - 120000).toISOString(), at: new Date(now - 60000).toISOString() };
const prepared = { ...task, id: randomUUID(), prompt: 'How did you set the table before dinner?', answer: 'I put the plates and glasses on the table.' };
const session = { id: randomUUID(), goal: '四级', mode: '对话', placement: false, targetCount: 5, startedAt: entry.askedAt, history: [entry], current: task,
  currentAskedAt: entry.askedAt, feedback: entry.feedback, prepared: { task: prepared, source: { provider: 'codex', model: '' } } };
await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1, config: { provider: 'codex', baseURL: '', model: '' }, profiles: {}, backgrounds: formal.backgrounds || [], sessions: [session] }));
const calls = [], codex = new CodexBridge({ directory });
const api = await createAPI({ directory, codex, modelCall: async (config, system, context) => {
  const start = Date.now();
  const result = await codex.complete(config, system, context);
  calls.push({ operation: Object.entries(prompts).find(([, v]) => v === system)?.[0], milliseconds: Date.now() - start, context, result });
  await mkdir(path.join(root, '.local/verification'), { recursive: true });
  await writeFile(path.join(root, '.local/verification/chat-discussion.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), syntheticFixture: true, calls }, null, 2));
  console.log(`Real Codex ${calls.at(-1).operation}: ${calls.at(-1).milliseconds}ms`);
  return result;
} });
const server = await createServer({ configFile: false, root, plugins: [{ name: 'chat-qa-api', configureServer(s) { s.middlewares.use(api); },
  transformIndexHtml() { return [{ tag: 'div', attrs: { style: 'position:fixed;bottom:0;left:0;z-index:99;padding:3px 8px;background:#fff1ce;font:11px sans-serif' }, children: '隔离验收 · 示例回答 · 真实 AI 追问', injectTo: 'body-prepend' }]; },
}], server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { deny: ['**/.local/**', '.env', '.env.*'] } } });
await server.listen();
console.log(`Chat QA: http://127.0.0.1:5174/\nState: ${directory}`);
async function close() { api.close(); await server.close(); process.exit(); }
process.once('SIGINT', close); process.once('SIGTERM', close);
