import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeClient, nativeFetcher } from '../src/native-client.js';
import { prompts, skills } from '../server/coach.js';

const question = n => ({ kind: 'text', skill: '表达', level: 'A2', prompt: `Describe your day ${n}.`, passage: '', audio: '', options: [], answer: 'I read a book.', hint: '用一句完整句子。', reason: '从日常回答了解表达能力。' });
test('phone runs a round without a server, persists profile, hides Codex/import and preserves state on storage failure', async () => {
  let value, fail = false, calls = 0;
  const store = { load: async () => ({ value }), save: async data => { if (fail) throw new Error(); value = data.value; } };
  const modelCall = async (_, system) => {
    calls++;
    if (system === prompts.gradeAndNext) return { feedback: { correct: true, explanation: '表达完整。', suggestion: 'I read a book today.', weakness: '' }, nextTask: question(2) };
    if (system === prompts.report) return { level: 'A2', summary: '根据这次日常表达给出初步建议。', nextFocus: '再练表达细节。', skills: skills.map(name => ({ name, level: 'A2', evidence: '日常练习记录。' })) };
    return question(1);
  };
  const client = await createNativeClient({ store, modelCall });
  assert.equal((await client.request('state')).providers.codex, undefined);
  await assert.rejects(client.request('settings', { provider: 'codex' }));
  await assert.rejects(client.request('background/import', {}));
  await assert.rejects(client.request('session/start', { placement: true }));
  await client.request('settings', { provider: 'openai', model: 'test-model', apiKey: 'test-only', baseURL: 'https://api.openai.com/v1' });
  let state = await client.request('session/start', { goal: '日常英语', mode: '写作' });
  const sessionId = state.sessions[0].id, taskId = state.sessions[0].current.id;
  assert.equal(state.sessions[0].current.answer, undefined);
  fail = true;
  await assert.rejects(client.request('session/answer', { sessionId, taskId, answer: 'I read a book.' }), /存储失败/);
  assert.equal((await client.request('state')).sessions[0].history.length, 0);
  fail = false;
  state = await client.request('session/answer', { sessionId, taskId, answer: 'I read a book.' });
  const beforeNext = calls;
  await client.request('session/next', { sessionId, taskId });
  assert.equal(calls, beforeNext);
  await client.request('session/finish', { sessionId });
  const restarted = await createNativeClient({ store, modelCall });
  state = await restarted.request('state');
  assert.equal(state.profile.level, 'A2');
  assert.equal(state.sessions[0].history.length, 1);
  assert.equal(state.config.apiKey, undefined);
});

test('phone transport uses native HTTPS with bounded timeouts and no redirects', async () => {
  let options;
  const fetcher = nativeFetcher({ request: async value => { options = value; return { status: 200, data: { ok: true } }; } });
  const result = await fetcher('https://provider.example/v1', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: '{"test":true}' });
  assert.equal(options.disableRedirects, true);
  assert.equal(options.readTimeout, 60000);
  assert.deepEqual(options.data, { test: true });
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(result.ok, true);
});

test('corrupt phone data is not silently replaced with an empty account', async () => {
  let saves = 0;
  await assert.rejects(createNativeClient({ store: { load: async () => ({ value: '{broken' }), save: async () => saves++ } }), /无法读取/);
  assert.equal(saves, 0);
});
