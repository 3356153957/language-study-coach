// Isolated browser QA: deliberately simulated responses, never user learning data.
import { createServer as createHTTPServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAPI } from '../server/api.js';
import { skills, prompts } from '../server/coach.js';

const tasks = [
  { kind: 'choice', skill: '语法', prompt: 'Yesterday I ___ to the library.', options: ['go', 'went', 'going'], answer: 'went', hint: '注意 Yesterday。' },
  { kind: 'listening', skill: '听力', prompt: 'When will the library open tomorrow?', audio: 'The library usually opens at nine. Tomorrow it will open at ten because the staff have a meeting. Please use the side entrance. The main entrance is being repaired.', options: ['At nine', 'At ten', 'At eleven'], answer: 'At ten', hint: '注意 tomorrow 后的时间。' },
  { kind: 'conversation', skill: '表达', prompt: 'What do you enjoy reading, and why?', options: [], answer: 'I enjoy reading stories because they help me relax.', hint: '用 because 说明原因。' },
  { kind: 'choice', skill: '阅读', passage: 'Mia started cycling to work last month. It takes longer than the train, but she enjoys the fresh air and saves money.', prompt: 'Why does Mia cycle to work?', options: ['It is faster.', 'She enjoys the air and saves money.'], answer: 'She enjoys the air and saves money.', hint: '寻找 but 后面的信息。' },
  { kind: 'choice', skill: '词汇', prompt: 'Choose the closest meaning of reliable.', options: ['Easy to trust', 'Hard to find'], answer: 'Easy to trust', hint: '想想能让你放心依靠的人。' },
  { kind: 'text', skill: '表达', prompt: 'Write one sentence about your plan for next week.', options: [], answer: 'I plan to read a short story next week.', hint: '可以用 I plan to…。' },
];

function nextTask(ctx) {
  const index = ctx.history.length;
  const template = ctx.mode === '对话' ? { ...tasks[2], prompt: index ? 'What would you recommend to a friend, and why?' : tasks[2].prompt }
    : ctx.mode === '听力' ? { ...tasks[1], prompt: tasks[1].prompt + ` (Round ${index + 1})` }
    : ctx.mode === '题卡' ? { ...tasks[0], prompt: tasks[0].prompt + ` (Round ${index + 1})` }
    : tasks[index % tasks.length];
  const result = { passage: '', audio: '', level: 'A2', reason: '【模拟联调】验证题型切换、回答保存和下一题流程。', ...template };
  if (ctx.review && index === 0) result.prompt = 'Last Monday, Emma ___ to the library.';
  return result;
}

const upstream = createHTTPServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  let result;
  const body = JSON.parse(raw), ctx = JSON.parse(body.messages.at(-1).content), system = body.messages[0].content;
  if (ctx.action === 'connection-test') result = { ok: true };
  else if (system === prompts.grade || system === prompts.gradeAndNext) {
    const correct = !ctx.task.options.length || ctx.answer === ctx.task.answer;
    result = { correct, explanation: correct ? '【模拟联调】回答符合题意。' : '【模拟联调】Yesterday 表示过去，应使用 went。', suggestion: '', weakness: correct ? '' : '一般过去时' };
    if (system === prompts.gradeAndNext) result = { feedback: result, nextTask: nextTask({ ...ctx, history: [...ctx.history, { task: ctx.task, answer: ctx.answer, feedback: result }] }) };
  } else if (system.includes('生成更新后的初步学习画像')) {
    result = { level: '仅供联调', summary: '这是隔离环境中的模拟小结，不是 AI 测评结果。', nextFocus: '模拟建议：继续练习过去时与听力细节。', skills: skills.map(name => ({ name, level: '仅供联调', evidence: '固定测试样例。' })) };
  } else result = nextTask(ctx);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
});
await new Promise(resolve => upstream.listen(5181, '127.0.0.1', resolve));
const directory = await mkdtemp(path.join(tmpdir(), 'lsc-browser-qa-'));
const api = await createAPI({ directory });
const vite = await createViteServer({ configFile: false, root: process.cwd(), plugins: [{ name: 'qa-api', configureServer(server) { server.middlewares.use(api); } }], server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { deny: ['**/.local/**', '.env', '.env.*'] } } });
await vite.listen();
console.log('Isolated QA UI: http://127.0.0.1:5174/');
console.log('Mock OpenAI-compatible URL: http://127.0.0.1:5181/v1; model: fixture; key: test-only');
async function stop() { await vite.close(); upstream.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
