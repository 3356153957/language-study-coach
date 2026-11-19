import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAPI } from '../server/api.js';
import { callModel, validateConfig, parseJSON, AppError } from '../server/providers.js';
import { prompts, gradingContext, validateTask, validateFeedback } from '../server/coach.js';

const config = { provider: 'compatible', baseURL: 'https://example.test/v1', model: 'test-model', apiKey: 'test-secret' };
const task = n => ({ kind: 'choice', skill: '语法', level: 'A2', reason: '检查过去时的理解', prompt: `练习 ${n}: Yesterday I ___ home.`, passage: '', audio: '', options: ['went', 'go'], answer: 'went', hint: '留意时间。' });
const report = { level: 'A2', summary: '样本很少，需要继续观察。', nextFocus: '继续练过去时。', skills: ['阅读','听力','词汇','语法','表达'].map(name => ({ name, level: 'A2', evidence: '测试返回' })) };

test('switching goals reuses one learner profile and cross-goal history; a new round preserves untested skills', async t => {
  const contexts = [];
  const h = await harness(t, async (cfg, prompt, ctx) => {
    contexts.push(ctx);
    if (prompt === prompts.report) return report;
    if (prompt === prompts.next) return ctx.goal === '高中英语' ? task(1) : { ...task(2), kind: 'text', skill: '表达', options: [], answer: 'I read a book.' };
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: task(3) };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: 'went' });
  const first = (await h.request('session/finish', { sessionId: s.id })).body.profile;
  s = (await h.request('session/start', { goal: '初中英语', mode: '写作' })).body.sessions.at(-1);
  assert.deepEqual(contexts.at(-1).profile, first);
  assert.equal(contexts.at(-1).recentHistory[0].goal, '高中英语');
  await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: 'I read a book.' });
  const result = await h.request('session/finish', { sessionId: s.id });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.profile.skills.find(x => x.name === '语法'), first.skills.find(x => x.name === '语法'));
  assert.equal(result.body.profile.skills.find(x => x.name === '表达').level, 'A2');
  const restored = await harness(t, () => { throw new Error('No model call on reload'); }, h.directory);
  assert.deepEqual((await restored.request('state')).body.profile, result.body.profile);
});

test('live evidence survives when the next question tests another skill', async t => {
  const reading = { ...task(2), skill: '阅读', passage: 'Mia reads every morning.', prompt: 'When does Mia read?' };
  const h = await harness(t, async (cfg, prompt) => {
    if (prompt === prompts.next) return task(1);
    if (prompt === prompts.report) return report;
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: reading };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  let result = await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: 'went' });
  s = result.body.sessions[0];
  assert.equal(result.body.profile.skills.find(x => x.name === '语法').level, '练习中');
  s = (await h.request('session/next', { sessionId: s.id, taskId: s.current.id })).body.sessions[0];
  result = await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: 'went' });
  assert.equal(result.body.profile.skills.find(x => x.name === '语法').level, '练习中');
  assert.equal(result.body.profile.skills.find(x => x.name === '阅读').level, '练习中');
});

test('a failed learning summary still closes the round and allows a new round', async t => {
  let failReport = true;
  const h = await harness(t, async (cfg, prompt) => {
    if (prompt === prompts.next) return task(1);
    if (prompt === prompts.report && failReport) throw new AppError('上游暂时不可用', 502);
    if (prompt === prompts.report) return report;
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: task(2) };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  s = (await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: 'went' })).body.sessions[0];
  const finished = await h.request('session/finish', { sessionId: s.id });
  assert.equal(finished.status, 200);
  assert.ok(finished.body.sessions[0].finishedAt);
  assert.match(finished.body.sessions[0].reportError, /上游暂时不可用/);
  assert.equal((await h.request('session/start', { goal: '日常英语', mode: '综合' })).status, 200);
});

test('follow-up clarification persists without regrading or consuming the prepared next task', async t => {
  const calls = [];
  const writing = { ...task(1), kind: 'text', skill: '表达', options: [], answer: 'Hidden sample.' };
  const h = await harness(t, async (cfg, prompt, ctx) => {
    calls.push({ prompt, ctx });
    if (prompt === prompts.next) return writing;
    if (prompt === prompts.discuss) return { reply: '你想说摆盘子：I had already put the plates on the table.' };
    return { feedback: { correct: false, explanation: '先前理解为菜肴。', suggestion: 'I had prepared the dish.', weakness: '时态和词义' }, nextTask: task(2) };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  const input = { sessionId: s.id, taskId: s.current.id };
  s = (await h.request('session/answer', { ...input, answer: 'I was prerary the dish on the desk' })).body.sessions[0];
  const feedback = structuredClone(s.feedback), history = structuredClone(s.history);
  const payload = { ...input, requestId: randomUUID(), message: '我想说提前把盘子放在餐桌上。' };
  const r = await h.request('session/discuss', payload);
  assert.equal(r.status, 200); s = r.body.sessions[0];
  assert.deepEqual(s.feedback, feedback); assert.deepEqual(s.history, history);
  assert.equal(s.nextReady, true); assert.equal(s.current.id, input.taskId);
  assert.equal(s.discussions[input.taskId].length, 1);
  assert.match(s.discussions[input.taskId][0].reply, /plates on the table/);
  assert.equal(calls.at(-1).ctx.learnerAnswer, 'I was prerary the dish on the desk');
  assert.equal('answer' in calls.at(-1).ctx.task, false);
  const count = calls.length;
  assert.equal((await h.request('session/discuss', payload)).status, 200);
  assert.equal(calls.length, count);
  assert.equal((await h.request('session/discuss', { ...payload, message: '变更了的消息' })).status, 409);
  s = (await h.request('session/next', input)).body.sessions[0];
  assert.equal(calls.length, count); assert.equal(s.current.prompt, task(2).prompt);
  const second = await h.request('session/discuss', { ...payload, requestId: randomUUID(), message: 'plate 和 dish 有什么区别？' });
  assert.equal(second.status, 200); assert.equal(calls.at(-1).ctx.discussion.length, 1);
  const restored = await harness(t, () => { throw new Error('Reload must not call model'); }, h.directory);
  assert.deepEqual((await restored.request('state')).body, second.body);
});

test('pre-answer coaching hides the key, marks assistance and passes discussion to grading; failed replies preserve state', async t => {
  const calls = []; let badReply = true;
  const h = await harness(t, async (cfg, prompt, ctx) => {
    calls.push({ prompt, ctx });
    if (prompt === prompts.next) return task(1);
    if (prompt === prompts.discuss) return badReply ? { reply: '' } : { reply: '注意 Yesterday 表示过去。' };
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: task(2) };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  const input = { sessionId: s.id, taskId: s.current.id };
  const payload = { ...input, requestId: randomUUID(), message: '可以解释一下时间词吗？', draftAnswer: 'go' };
  const before = (await h.request('state')).body;
  assert.equal((await h.request('session/discuss', payload)).status, 502);
  assert.deepEqual((await h.request('state')).body, before);
  badReply = false;
  assert.equal((await h.request('session/discuss', { ...payload, taskId: randomUUID() })).status, 409);
  assert.equal((await h.request('session/discuss', { ...payload, message: ' ' })).status, 400);
  assert.equal((await h.request('session/discuss', payload)).status, 200);
  assert.equal('answer' in calls.at(-1).ctx.task, false);
  assert.equal(calls.at(-1).ctx.answered, false);
  assert.equal(calls.at(-1).ctx.learnerAnswer, 'go');
  s = (await h.request('session/answer', { ...input, answer: 'went', hintUsed: false })).body.sessions[0];
  assert.equal(s.history[0].hintUsed, true);
  assert.equal(calls.at(-1).ctx.discussion[0].message, payload.message);
  assert.equal(calls.at(-1).ctx.telemetry.hintUsed, true);
});

test('imported learning background is persisted, deduplicated, shared across goals and never creates scores or time', async t => {
  const contexts = [];
  const h = await harness(t, async (cfg, prompt, ctx) => { contexts.push(ctx); return task(1); });
  const payload = { goal: '四级', source: { kind: 'codex-chat', threadId: randomUUID(), title: '英语' }, summary: '备考四级，需要巩固过去时。',
    coveredTopics: ['一般过去时'], strengths: ['曾正确辨认 went。'], needsPractice: ['did not + 动词原形'], preferences: ['每天约 1 小时'],
    evidence: [{ turnId: randomUUID(), observedAt: '2026-11-14T00:00:00Z', learnerText: 'I did not to the library.', observation: '缺少动词 go。' }],
    profiles: { '四级': { level: 'C2' } }, sessions: [{ history: [1, 2, 3] }] };
  let r = await h.request('background/import', payload);
  assert.equal(r.status, 200); assert.equal(r.body.backgrounds.length, 1);
  assert.deepEqual(r.body.profiles, {}); assert.deepEqual(r.body.sessions, []);
  r = await h.request('background/import', payload);
  assert.equal(r.body.backgrounds.length, 1);
  const before = r.body;
  assert.equal((await h.request('background/import', { ...payload, evidence: [] })).status, 400);
  assert.deepEqual((await h.request('state')).body, before);
  await h.request('settings', config);
  const s = (await h.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  assert.equal(contexts.at(-1).learningBackground[0].source.title, '英语');
  await h.request('session/finish', { sessionId: s.id });
  await h.request('session/start', { goal: '日常英语', mode: '综合' });
  assert.equal(contexts.at(-1).learningBackground[0].source.title, '英语');
  const restored = await harness(t, () => { throw new Error('Must not call model'); }, h.directory);
  assert.deepEqual((await restored.request('state')).body.backgrounds, before.backgrounds);
});

test('keys are retained only for the same provider and exact base URL', () => {
  assert.equal(validateConfig({ ...config, apiKey: '' }, config).apiKey, 'test-secret');
  assert.throws(() => validateConfig({ ...config, baseURL: 'https://other.test/v1', apiKey: '' }, config));
  assert.throws(() => validateConfig({ ...config, baseURL: 'http://example.test/v1' }));
  assert.throws(() => validateConfig({ ...config, baseURL: 'https://example.test/v1?key=abc' }));
});

for (const provider of ['openai', 'compatible', 'deepseek', 'anthropic', 'gemini']) {
  test(`${provider}: authenticated request and response adapter`, async () => {
    const result = await callModel({ ...config, provider }, 'system instruction', { answer: 'hello' }, async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal);
      assert.equal(url.includes('test-secret'), false);
      if (provider === 'anthropic') {
        assert.ok(url.endsWith('/messages'));
        assert.equal(init.headers['x-api-key'], 'test-secret');
        assert.equal(body.system, 'system instruction');
        return Response.json({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"ok":true}' }] });
      }
      if (provider === 'gemini') {
        assert.ok(url.endsWith('/models/test-model:generateContent'));
        assert.equal(init.headers['x-goog-api-key'], 'test-secret');
        assert.equal(body.systemInstruction.parts[0].text, 'system instruction');
        return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'private' }, { text: '{"ok":true}' }] } }] });
      }
      assert.ok(url.endsWith('/chat/completions'));
      assert.equal(init.headers.Authorization, 'Bearer test-secret');
      assert.equal(body.messages[0].content, 'system instruction');
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    assert.deepEqual(result, { ok: true });
  });
}

test('upstream auth, timeout, empty content and malformed JSON produce actionable errors without exposing credentials', async () => {
  await assert.rejects(callModel(config, '', {}, async () => new Response('test-secret', { status: 401 })), /401.*API Key/);
  await assert.rejects(callModel(config, '', {}, async () => { throw new DOMException('test-secret', 'TimeoutError'); }), /60 秒/);
  await assert.rejects(callModel(config, '', {}, async () => Response.json({ choices: [] })), /没有返回文本/);
  assert.throws(() => parseJSON('not json'), /格式不正确/);
  assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'), { ok: true });
});

test('reject broken question material, duplicate questions and contradictory grading', () => {
  const session = { mode: '综合', history: [{ task: task(1) }] };
  assert.throws(() => validateTask(task(1), session), /重复/);
  assert.throws(() => validateTask({ ...task(2), skill: '阅读' }, session), /完整/);
  assert.throws(() => validateTask({ ...task(2), answer: 'missing' }, session), /不一致/);
  assert.throws(() => validateTask(task(2), { mode: '对话', history: [] }), /练习方式/);
  assert.throws(() => validateFeedback({ correct: true }, task(1), 'go'), /矛盾/);
});

test('open writing keeps the original answer but omits the sample; choice grading retains the key', () => {
  const original = 'Yesterday I went to a nearby shop to buy some vegetables ,beacause when cooking dinner I found no vegetables at home';
  const writing = { ...task(1), kind: 'text', skill: '表达', options: [], answer: 'This is an independent sample answer.' };
  const ctx = gradingContext({ history: [] }, writing, original, { hintUsed: false });
  assert.equal(ctx.answer, original);
  assert.equal('answer' in ctx.task, false);
  assert.equal(writing.answer, 'This is an independent sample answer.');
  assert.equal(gradingContext({}, task(1), 'go', {}).task.answer, 'went');
  const feedback = { correct: true, explanation: '表达准确。', suggestion: original, weakness: '' };
  assert.equal(validateFeedback(feedback, writing, original).suggestion, '');
  assert.equal(validateFeedback({ ...feedback, suggestion: 'went' }, task(1), 'went').suggestion, '');
});

async function harness(t, modelCall, directory) {
  directory ||= await mkdtemp(path.join(tmpdir(), 'lsc-test-'));
  const api = await createAPI({ directory, modelCall });
  const server = createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, extra = {}) => {
    const res = await fetch(`${base}/api/${route}`, body === undefined ? extra : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Request': '1', ...extra }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { request, directory, base };
}

test('full placement: hidden answers, adaptive context, idempotent grading, report and restart persistence', async t => {
  const contexts = [];
  const fake = async (cfg, prompt, ctx) => {
    if (!cfg) throw new AppError('请先配置 API。', 409);
    contexts.push(structuredClone(ctx));
    if (prompt === prompts.next) return task(ctx.review ? 100 + ctx.history.length : ctx.history.length + 1);
    if (prompt === prompts.report) return report;
    const feedback = { correct: ctx.answer === 'went', explanation: 'Yesterday 表示过去。', suggestion: '', weakness: '过去时' };
    return prompt === prompts.gradeAndNext ? { feedback, nextTask: task(ctx.history.length + 2) } : feedback;
  };
  const h = await harness(t, fake), req = h.request;
  assert.equal((await req('session/start', { goal: '高中英语', mode: '综合', placement: true })).status, 409);
  const saved = await req('settings', config);
  assert.equal(JSON.stringify(saved).includes('test-secret'), false);
  assert.equal((await req('settings', config, { Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${h.base}/api/state`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(hostStatus, 403);
  let r = await req('session/start', { goal: '高中英语', mode: '综合', placement: true });
  assert.equal(r.status, 200);
  let s = r.body.sessions[0];
  assert.equal('answer' in s.current, false);
  assert.equal((await req('session/next', { sessionId: s.id, taskId: s.current.id })).status, 400);
  for (let i = 0; i < 6; i++) {
    const input = { sessionId: s.id, taskId: s.current.id, answer: i === 0 ? 'go' : 'went', activeSeconds: 12, hintUsed: i === 0 };
    r = await req('session/answer', input); assert.equal(r.status, 200); s = r.body.sessions[0];
    assert.equal(s.nextReady, i < 5);
    const count = contexts.length;
    r = await req('session/answer', input);
    assert.equal(r.body.sessions[0].history.length, i + 1);
    assert.equal(contexts.length, count);
    if (i < 5) { r = await req('session/next', { sessionId: s.id, taskId: s.current.id }); s = r.body.sessions[0]; }
  }
  assert.ok(contexts.some(ctx => ctx.history?.[0]?.hintUsed));
  assert.equal((await req('session/next', { sessionId: s.id, taskId: s.current.id })).status, 400);
  r = await req('session/finish', { sessionId: s.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.sessions[0].history.reduce((n,x) => n + x.activeSeconds, 0), 72);
  assert.equal(r.body.profile.skills.find(x => x.name === '听力').level, '未测评');
  const reloaded = await harness(t, fake, h.directory);
  assert.deepEqual((await reloaded.request('state')).body, r.body);
  const reviewId = r.body.sessions[0].history[0].id;
  r = await req('session/start', { goal: '高中英语', mode: '综合', reviewId });
  assert.equal(r.status, 200);
  assert.equal(contexts.at(-1).review.id, reviewId);
  assert.ok((await readFile(path.join(h.directory, 'state.json'), 'utf8')).includes('test-secret'));
});

test('failed grading preserves current task; overlapping requests do not overwrite progress', async t => {
  let release, shouldFail = false, pending = false;
  const fake = async (cfg, prompt) => {
    if (prompt === prompts.next) return task(1);
    if (shouldFail) throw new AppError('测试上游错误', 502);
    if (pending) await new Promise(resolve => { release = resolve; });
    const feedback = { correct: true, explanation: '正确。', suggestion: '', weakness: '' };
    return prompt === prompts.gradeAndNext ? { feedback, nextTask: task(2) } : feedback;
  };
  const { request } = await harness(t, fake);
  await request('settings', config);
  const s = (await request('session/start', { goal: '日常英语', mode: '综合' })).body.sessions[0];
  const payload = { sessionId: s.id, taskId: s.current.id, answer: 'went' };
  shouldFail = true;
  assert.equal((await request('session/answer', payload)).status, 502);
  assert.equal((await request('state')).body.sessions[0].history.length, 0);
  shouldFail = false; pending = true;
  const first = request('session/answer', payload);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await request('session/answer', payload)).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await request('state')).body.sessions[0].history.length, 1);
});

test('grading prepares a private persisted next question; switching never calls the model again', async t => {
  const calls = [];
  const fake = async (cfg, prompt, ctx) => {
    calls.push({ prompt, ctx });
    if (prompt === prompts.next) return task(1);
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: task(2) };
  };
  const first = await harness(t, fake);
  await first.request('settings', config);
  const session = (await first.request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  const input = { sessionId: session.id, taskId: session.current.id, answer: 'went' };
  const graded = (await first.request('session/answer', input)).body.sessions[0];
  assert.equal(calls.at(-1).prompt, prompts.gradeAndNext);
  assert.equal(graded.nextReady, true);
  assert.equal('prepared' in graded, false);
  assert.ok(!JSON.stringify(graded).includes(task(2).prompt));
  assert.equal((await first.request('session/answer', input)).body.sessions[0].history.length, 1);
  const count = calls.length;
  const reloaded = await harness(t, () => { throw new Error('Switching must use the prepared question'); }, first.directory);
  const second = (await reloaded.request('session/next', input)).body.sessions[0];
  assert.equal(second.current.prompt, task(2).prompt);
  assert.equal('answer' in second.current, false);
  assert.equal(second.nextReady, false);
  assert.equal(second.feedback, null);
  assert.equal(calls.length, count);
});

test('an invalid prepared task preserves feedback and is regenerated only on next', async t => {
  let nextCalls = 0;
  const { request } = await harness(t, async (cfg, prompt) => {
    if (prompt === prompts.next) return task(++nextCalls);
    return { feedback: { correct: true, explanation: '正确。', suggestion: '', weakness: '' }, nextTask: task(1) };
  });
  await request('settings', config);
  const session = (await request('session/start', { goal: '高中英语', mode: '综合' })).body.sessions[0];
  const input = { sessionId: session.id, taskId: session.current.id, answer: 'went' };
  const graded = (await request('session/answer', input)).body.sessions[0];
  assert.equal(graded.history.length, 1);
  assert.equal(graded.feedback.correct, true);
  assert.equal(graded.nextReady, false);
  assert.match(graded.nextPreparationError, /重新生成/);
  assert.equal(nextCalls, 1);
  const second = (await request('session/next', input)).body.sessions[0];
  assert.equal(nextCalls, 2);
  assert.equal(second.current.prompt, task(2).prompt);
  assert.equal(second.nextPreparationError, '');
});

test('writing grade-and-next receives the learner wording without its sample answer', async t => {
  const writing = { ...task(1), kind: 'text', skill: '表达', options: [], answer: 'A sample answer that must stay out of grading.' };
  const original = 'Yesterday I went shopping ,beacause I found no vegetables at home';
  const improved = 'Yesterday, I went shopping because I found no vegetables at home.';
  const { request } = await harness(t, async (cfg, prompt, ctx) => {
    if (prompt === prompts.next) return writing;
    assert.equal(prompt, prompts.gradeAndNext);
    assert.equal(ctx.answer, original);
    assert.equal('answer' in ctx.task, false);
    return { feedback: { correct: true, explanation: '修正 because 的拼写和标点，保留先购物再解释原因的顺序。', suggestion: improved, weakness: '' }, nextTask: task(2) };
  });
  await request('settings', config);
  const s = (await request('session/start', { goal: '日常英语', mode: '综合' })).body.sessions[0];
  const result = await request('session/answer', { sessionId: s.id, taskId: s.current.id, answer: original });
  assert.equal(result.status, 200);
  assert.equal(result.body.sessions[0].feedback.suggestion, improved);
  assert.equal(result.body.sessions[0].current.answer, writing.answer);
});

test('B1 reading and listening tasks can contain multiple questions while hiding keys until answered', async t => {
  const grouped = { kind: 'choice', skill: '阅读', level: 'B1', reason: '练习文章主旨与细节', prompt: 'Read the passage and answer the questions.', passage: 'Mia takes the early train because it is quiet.', translation: '米娅乘坐早班火车，因为那时很安静。', audio: '', options: [], answer: '', hint: '先找原因。', questions: [
    { prompt: 'Why does Mia take the early train?', options: ['It is quiet.', 'It is free.'], answer: 'It is quiet.' },
    { prompt: 'What does Mia take?', options: ['A train.', 'A taxi.'], answer: 'A train.' },
  ] };
  const h = await harness(t, async (cfg, prompt, ctx) => {
    if (prompt === prompts.next) return grouped;
    if (prompt === prompts.grade) return { correct: true, explanation: '两问都答对了。', suggestion: '', weakness: '' };
    return { feedback: { correct: true, explanation: '两问都答对了。', suggestion: '', weakness: '' }, nextTask: { ...grouped, prompt: 'A different follow-up question.', questions: [{ prompt: 'A follow-up?', options: ['Yes', 'No'], answer: 'Yes' }] } };
  });
  await h.request('settings', config);
  let s = (await h.request('session/start', { goal: '高中英语', mode: '阅读' })).body.sessions[0];
  assert.equal(s.current.questions.length, 2);
  assert.equal(s.current.questions[0].answer, undefined);
  assert.equal(s.current.translation, undefined);
  const answer = JSON.stringify(['It is quiet.', 'A train.']);
  const result = await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer });
  assert.equal(result.status, 200);
  assert.equal(result.body.sessions[0].history[0].answer, answer);
  assert.equal(result.body.sessions[0].current.translation, grouped.translation);
});

test('open multi-question writing uses one answer box per prompt and accepts JSON answers', async t => {
  const grouped = { kind: 'text', skill: '表达', level: 'B1', reason: '练习分步骤表达', prompt: 'Answer each question in English.', passage: '', translation: '', audio: '', options: [], answer: '', hint: '先写完整句子。', questions: [
    { prompt: 'What did you do yesterday?', options: [], answer: 'I went shopping.' },
    { prompt: 'Why did you do it?', options: [], answer: 'I needed vegetables.' },
  ] };
  const h = await harness(t, async (cfg, prompt) => prompt === prompts.next ? grouped : { feedback: { correct: true, explanation: '两部分都表达清楚了。', suggestion: '', weakness: '', questions: grouped.questions.map(()=>({correct:true,explanation:'该项表达清楚。',suggestion:'',weakness:''})) }, nextTask: { ...task(9), prompt: 'A different next task.' } });
  await h.request('settings', config);
  const s = (await h.request('session/start', { goal: '日常英语', mode: '写作' })).body.sessions[0];
  const answer = JSON.stringify(['I went shopping.', 'I needed vegetables.']);
  const result = await h.request('session/answer', { sessionId: s.id, taskId: s.current.id, answer });
  assert.equal(result.status, 200);
  assert.equal(result.body.sessions[0].history[0].answer, answer);
});

test('ChatGPT callback returns the app to the settings state after authorization', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lsc-auth-callback-'));
  const api = await createAPI({ directory, modelCall: async () => ({ ok: true }), codex: { close() {}, status: async () => ({ loggedIn: false }) }, chatgpt: {
    finish: async () => ({ loggedIn: true }), status: async () => ({ loggedIn: true }), models: async () => [], complete: async () => ({ ok: true }),
  } });
  const server = createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { api.close(); server.close(resolve); }));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/auth/callback?code=test&state=test`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /\?chatgpt=callback/);
});
