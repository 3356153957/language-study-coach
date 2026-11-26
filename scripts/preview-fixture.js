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

// CET goals must use real exam parts; these fixtures cover the many-option parts.
const bank = ['adopt', 'benefit', 'crucial', 'decline', 'efficient', 'flexible', 'gradually', 'highlight', 'impact', 'journey', 'keen', 'launch', 'maintain', 'notable', 'obtain'];
const clozeAnswers = ['adopt', 'efficient', 'gradually', 'benefit', 'impact', 'maintain', 'crucial', 'flexible', 'obtain', 'notable'];
const paragraphs = 'ABCDEFGHIJ'.split('');
const cetTasks = {
  选词填空: { kind: 'choice', skill: '阅读', examPart: '选词填空', prompt: '阅读短文，从词库中为每个空选择一个词，每个词最多用一次。',
    passage: 'More universities now (1)____ online courses. Students find them (2)____ because they can study at home. Skills improve (3)____ with practice, and many learners (4)____ from instant feedback. Teachers say the (5)____ on attendance is small, but schools must (6)____ quality. Clear goals are (7)____, and a (8)____ timetable helps. Students who (9)____ good results often share (10)____ tips with classmates.',
    translation: '（模拟译文）越来越多的大学开设网课……', options: [], answer: '',
    questions: clozeAnswers.map((answer, i) => ({ prompt: `第 ${i + 1} 空`, options: bank, answer })) },
  长篇阅读: { kind: 'choice', skill: '阅读', examPart: '长篇阅读', prompt: '下列每个陈述对应文中一个段落，段落可重复选择。',
    passage: paragraphs.map(p => `${p}) Paragraph ${p}: a short simulated paragraph about how students use public libraries in different ways.`).join('\n'),
    translation: '（模拟译文）', options: [], answer: '',
    questions: Array.from({ length: 10 }, (_, i) => ({ prompt: `Statement ${i + 1}: a detail that appears in paragraph ${paragraphs[i % 6]}.`, options: paragraphs, answer: paragraphs[i % 6] })) },
  仔细阅读: { kind: 'choice', skill: '阅读', examPart: '仔细阅读', prompt: '阅读短文，回答问题。',
    passage: 'Community gardens have spread across many cities. They give residents fresh food, a place to meet neighbours and a chance to learn about nature. Some critics worry about the cost of land, but supporters argue that the social benefits are worth it.',
    translation: '（模拟译文）', options: [], answer: '',
    questions: [
      { prompt: 'What is the passage mainly about?', options: ['Community gardens', 'Land prices', 'City parks', 'Farming jobs'], answer: 'Community gardens' },
      { prompt: 'What do critics worry about?', options: ['Noise', 'The cost of land', 'Water supply', 'Safety'], answer: 'The cost of land' },
    ] },
  短篇新闻: { kind: 'listening', skill: '听力', examPart: '短篇新闻', prompt: '听新闻，回答问题。',
    audio: 'A city library opened a new reading room on Monday. The room stays open until midnight during the exam season, and students can borrow laptops there.', options: [], answer: '',
    questions: [
      { prompt: 'What opened on Monday?', options: ['A reading room', 'A cafe', 'A gym', 'A bookshop'], answer: 'A reading room' },
      { prompt: 'What can students borrow?', options: ['Books only', 'Laptops', 'Bikes', 'Cameras'], answer: 'Laptops' },
    ] },
  写作: { kind: 'text', skill: '表达', examPart: '写作', prompt: 'Write a short essay on the value of volunteering. You should write at least 60 words (the real exam asks for 120–180).', options: [], answer: 'Volunteering helps others and builds useful skills.' },
};
const cetOrder = { 综合: ['选词填空', '长篇阅读', '仔细阅读', '短篇新闻', '写作'], 阅读: ['选词填空', '长篇阅读', '仔细阅读'], 听力: ['短篇新闻'], 写作: ['写作'] };

function nextTask(ctx) {
  if (['四级', '六级'].includes(ctx.goal)) {
    const order = cetOrder[ctx.mode] || cetOrder.综合;
    return { passage: '', audio: '', translation: '', level: 'B1', hint: '【模拟联调】先看清题型要求。', reason: '【模拟联调】验证四六级真题题型的渲染与作答。', ...cetTasks[order[ctx.history.length % order.length]] };
  }
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
  // Model discovery lists the single fixture model, like a real compatible provider.
  if (req.method === 'GET' && new URL(req.url, 'http://fixture').pathname.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture', object: 'model' }] }));
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  let result, body, ctx, system;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); ctx = JSON.parse(body.messages.at(-1).content); system = body.messages[0].content; }
  catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'fixture expects a chat completion request' } })); }
  if (ctx.action === 'connection-test') result = { ok: true };
  else if (system === prompts.conversation) result = ctx.message.includes('多做') ? {
    reply: '【模拟联调】点击应用，之后的综合练习会参考这个偏好。',
    practicePreference: '多练短选择和短表达，减少长篇阅读。',
  } : { reply: '【模拟联调】可以先聊聊。你最近比较感兴趣的是什么？' };
  else if (system === prompts.grade || system === prompts.gradeAndNext) {
    const items = ctx.task.questions?.length ? ctx.task.questions : [{ options: ctx.task.options, answer: ctx.task.answer }];
    let values = [ctx.answer]; try { if (items.length > 1) values = JSON.parse(ctx.answer); } catch { values = []; }
    const correct = items.every((item, i) => !item.options?.length || values[i] === item.answer);
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
