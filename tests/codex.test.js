import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { CodexBridge, officialURL } from '../server/codex.js';
import { createAPI } from '../server/api.js';
import { validateConfig } from '../server/providers.js';
import { prompts } from '../server/coach.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lsc-codex-test-'));
  const calls = [], child = new EventEmitter();
  let loggedIn = options.loggedIn ?? true;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const send = message => child.stdout.write(JSON.stringify(message) + '\n');
  child.kill = () => { child.emit('exit', 0); child.stdout.end(); child.stderr.end(); };
  child.stdin = new Writable({ write(chunk, encoding, callback) {
    const message = JSON.parse(chunk.toString()); calls.push(message);
    const { id, method, params } = message;
    callback();
    if (id === undefined || !method) return;
    let result = {};
    if (method === 'account/read') result = { account: loggedIn ? { type: 'chatgpt', email: 'learner@example.test', planType: 'plus', token: 'never-return-me' } : null };
    if (method === 'model/list') result = { data: [{ model: 'fixture-model', displayName: 'Fixture', isDefault: true }] };
    if (method === 'account/login/start') result = { loginId: 'login-fixture', authUrl: 'https://auth.openai.com/authorize?state=fixture', ...(params.type === 'chatgptDeviceCode' ? { userCode: 'TEST-CODE' } : {}) };
    if (method === 'config/read') result = { config: { model_reasoning_effort: 'xhigh', mcp_servers: { 'fixture-mcp': { command: 'do-not-run', tool_timeout_sec: null } }, plugins: { 'fixture-plugin': { enabled: true } } } };
    if (method === 'thread/start') result = { thread: { id: 'thread-fixture' } };
    if (method === 'turn/start') {
      result = { turn: { id: 'turn-fixture' } };
      // Deliberately deliver completion before the RPC reply.
      if (!options.hang) {
        send({ method: 'item/completed', params: { threadId: 'thread-fixture', item: { type: 'agentMessage', text: '{"ok":true}' } } });
        send({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { status: options.failed ? 'failed' : 'completed' } } });
      }
    }
    if (options.rpcError === method) return send({ id, error: { code: -1, message: 'never-return-me' } });
    send({ id, result });
  } });
  const bridge = new CodexBridge({ directory, launch: () => child, turnTimeout: options.hang ? 25 : 1000 });
  t.after(() => bridge.close());
  return { bridge, directory, calls, send, setLoggedIn: value => { loggedIn = value; } };
}

test('Codex reuses login, masks account, returns a model list and never exposes auth tokens', async t => {
  const { bridge, calls } = await fixture(t);
  const s = await bridge.loginStart('chatgpt');
  assert.equal(s.loggedIn, true);
  assert.equal(s.account.email, 'l***@example.test');
  assert.equal(s.models[0].id, 'fixture-model');
  assert.ok(!JSON.stringify(s).includes('never-return-me'));
  assert.ok(!calls.some(c => c.method === 'account/login/start'));
  assert.deepEqual(validateConfig({ provider: 'codex', apiKey: 'must-be-discarded' }), { provider: 'codex', baseURL: '', model: '' });
});

test('browser/device authorization, completion and cancellation stay in memory', async t => {
  const { bridge, send, setLoggedIn, calls } = await fixture(t, { loggedIn: false });
  let s = await bridge.loginStart('chatgpt');
  assert.equal(s.login.state, 'pending'); assert.equal(s.login.id, undefined);
  await bridge.cancelLogin();
  assert.ok(calls.some(c => c.method === 'account/login/cancel'));
  s = await bridge.loginStart('chatgptDeviceCode');
  assert.equal(s.login.userCode, 'TEST-CODE');
  setLoggedIn(true);
  send({ method: 'account/login/completed', params: { loginId: 'login-fixture', success: true } });
  s = await bridge.status();
  assert.equal(s.loggedIn, true); assert.equal(s.login.state, 'completed');
  assert.equal(s.login.userCode, undefined); assert.equal(s.login.url, undefined);
  await assert.rejects(bridge.loginStart('externalTokens'), /请选择/);
  assert.throws(() => officialURL('https://auth.openai.com.evil.test/'), /授权地址/);
  assert.throws(() => officialURL('javascript:alert(1)'), /授权地址/);
});

test('Codex ephemeral tutoring disables tools and handles completion before turn acknowledgement', async t => {
  const { bridge, calls } = await fixture(t);
  assert.deepEqual(await bridge.complete({ model: 'fixture-model' }, 'Tutor instruction', { answer: 'hello' }), { ok: true });
  const thread = calls.find(c => c.method === 'thread/start').params;
  assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.config['features.shell_tool'], false);
  assert.equal(thread.config.mcp_servers['fixture-mcp'].enabled, false);
  assert.equal('tool_timeout_sec' in thread.config.mcp_servers['fixture-mcp'], false);
  assert.equal(thread.config.plugins['fixture-plugin'].enabled, false);
  assert.ok(calls.some(c => c.method === 'thread/unsubscribe'));
});

test('tutoring uses low effort and reports use medium even when global Codex effort is xhigh', async t => {
  const { bridge, calls } = await fixture(t);
  for (const [system, effort] of [[prompts.next, 'low'], [prompts.grade, 'low'], [prompts.gradeAndNext, 'low'], [prompts.discuss, 'low'], [prompts.report, 'medium'], ['connection test', 'low']]) {
    await bridge.complete({ model: 'fixture-model' }, system, {});
    const thread = calls.findLast(c => c.method === 'thread/start').params;
    const turn = calls.findLast(c => c.method === 'turn/start').params;
    assert.equal(thread.model, 'fixture-model');
    assert.equal(thread.config.model_reasoning_effort, effort);
    assert.equal(turn.effort, effort);
  }
  assert.ok(!calls.some(c => c.method?.startsWith('config/') && c.method !== 'config/read'));
});

test('failed/timeout turns never return partial success; timeout interrupts the active turn', async t => {
  const failed = await fixture(t, { failed: true });
  await assert.rejects(failed.bridge.complete({}, '', {}), /未完成/);
  const hanging = await fixture(t, { hang: true });
  await assert.rejects(hanging.bridge.complete({}, '', {}), /超过 120 秒/);
  assert.ok(hanging.calls.some(c => c.method === 'turn/interrupt'));
  const broken = await fixture(t, { rpcError: 'thread/start' });
  await assert.rejects(broken.bridge.complete({}, '', {}), error => !error.message.includes('never-return-me'));
});

test('unexpected tool requests are refused and disconnect rejects a pending turn', async t => {
  const { bridge, calls, send } = await fixture(t, { hang: true });
  await bridge.ready();
  send({ id: 'tool-request', method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(calls.find(c => c.id === 'tool-request').error.code, -32601);
  const running = bridge.complete({}, '', {});
  const rejected = assert.rejects(running, /断开/);
  while (!calls.some(c => c.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
  bridge.close();
  await rejected;
});

test('local API saves Codex without keys, dispatches real adapter contract and protects login endpoints', async t => {
  const { bridge, directory, setLoggedIn } = await fixture(t);
  const api = await createAPI({ directory, codex: bridge });
  const server = createServer((req, res) => api(req, res, () => res.end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { api.close(); server.close(resolve); }));
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  const post = (route, body, headers = {}) => fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Request': '1', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('codex/login', { type: 'chatgpt' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await fetch(root + 'codex/status', { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await post('settings', { provider: 'codex' })).status, 200);
  assert.equal((await post('settings/test', {})).status, 200);
  const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(state.config, { provider: 'codex', model: '', baseURL: '' });
  setLoggedIn(false);
  assert.equal((await post('settings', { provider: 'codex' })).status, 409);
  assert.equal((await post('settings/test', {})).status, 409);
  const pending = await (await post('codex/login', { type: 'chatgptDeviceCode' })).json();
  assert.equal(pending.login.state, 'pending');
  assert.ok(!(await readFile(path.join(directory, 'state.json'), 'utf8')).includes('TEST-CODE'));
  assert.equal((await post('codex/login/cancel', {})).status, 200);
});
