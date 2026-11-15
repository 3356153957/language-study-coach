// Explicit opt-in only: calls the real signed-in Codex account, using isolated test data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAPI } from '../server/api.js';
import { CodexBridge } from '../server/codex.js';
import { prompts } from '../server/coach.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'lsc-real-codex-'));
const codex = new CodexBridge({ directory });
const calls = [];
let generated;
const api = await createAPI({ directory, codex, modelCall: async (config, system, context) => {
  const start = Date.now();
  const result = await codex.complete(config, system, context);
  calls.push({ operation: system === prompts.next ? 'question' : system === prompts.gradeAndNext ? 'grade-and-next' : system === prompts.grade ? 'grade' : 'report', milliseconds: Date.now() - start });
  if (system === prompts.next) generated = result;
  if (system === prompts.gradeAndNext) generated = result.nextTask;
  return result;
} });
const server = createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/`;
const request = async (route, body) => {
  const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Request': '1' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, 200, `${route}: ${result.error || response.status}`);
  return result;
};
let preview;
async function close() {
  api.close();
  if (preview) await preview.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
process.once('SIGINT', () => { close().finally(() => process.exit()); });
process.once('SIGTERM', () => { close().finally(() => process.exit()); });
try {
  console.log('真实 Codex 验收：6 题初测、批改、小结、恢复与错题再练。测试回答保存在独立临时目录。');
  await request('settings', { provider: 'codex' });
  let state = await request('session/start', { goal: '四级', mode: '综合', placement: true });
  let session = state.sessions[0];
  for (let i = 0; i < 6; i++) {
    assert.equal('answer' in session.current, false, '答题前不得向浏览器发送参考答案');
    // One deliberately incorrect answer exercises the error-review path. Other answers
    // use the model's reference: this checks integration, not independent teaching accuracy.
    const answer = i === 0 ? session.current.options.find(x => x !== generated.answer) || 'I do not know.' : generated.answer;
    const input = { sessionId: session.id, taskId: session.current.id, answer, activeSeconds: 15, hintUsed: i === 0 };
    state = await request('session/answer', input); session = state.sessions[0];
    assert.equal(session.nextReady, i < 5, '批改时应准备好下一题，最后一题除外');
    console.log(`第 ${i + 1}/6 题：${session.current.skill} ${session.current.level}；批改${session.feedback.correct ? '正确' : '错误'}；记录已保存`);
    const before = calls.length;
    await request('session/answer', input);
    assert.equal(calls.length, before, '重复提交不应再次消耗模型额度');
    assert.equal((await request('state')).sessions[0].history.length, i + 1);
    if (i < 5) {
      state = await request('session/next', { sessionId: session.id, taskId: session.current.id }); session = state.sessions[0];
      assert.equal(calls.length, before, '切换到已准备的下一题不应再次请求模型');
    }
  }
  state = await request('session/finish', { sessionId: session.id });
  session = state.sessions[0];
  assert.ok(session.finishedAt); assert.equal(session.report.skills.length, 5);
  assert.deepEqual(state.profile.skills, session.report.skills);
  console.log('学习小结与五项能力画像已生成。');
  const restored = await createAPI({ directory });
  const restoredServer = createServer((req, res) => restored(req, res, () => res.end()));
  try {
    await new Promise(resolve => restoredServer.listen(0, '127.0.0.1', resolve));
    const persisted = await (await fetch(`http://127.0.0.1:${restoredServer.address().port}/api/state`)).json();
    assert.deepEqual(persisted, state);
  } finally { restored.close(); await new Promise(resolve => restoredServer.close(resolve)); }
  const mistake = session.history.find(x => !x.feedback.correct);
  assert.ok(mistake, '应有一条错误回答用于复习验证');
  state = await request('session/start', { goal: '四级', mode: '综合', reviewId: mistake.id });
  const review = state.sessions.at(-1);
  assert.equal(review.review.id, mistake.id);
  assert.notEqual(review.current.prompt, mistake.task.prompt);
  // Leave the isolated preview on the completed placement, without an active test round.
  state = await request('session/finish', { sessionId: review.id });
  const reportFile = path.join(root, '.local', 'verification', 'codex-flow.json');
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify({ verifiedAt: new Date().toISOString(), syntheticAnswers: true, calls, state }, null, 2));
  console.log(`验收通过：${calls.length} 次真实模型调用；持久化恢复、重复提交与错题再练通过。`);
  console.log(`验收记录：${reportFile}`);
  if (process.argv.includes('--preview')) {
    const { createServer: createViteServer } = await import('vite');
    preview = await createViteServer({ configFile: false, root, plugins: [{
      name: 'real-codex-verification', configureServer(s) { s.middlewares.use(api); },
      transformIndexHtml() { return [{ tag: 'div', attrs: { style: 'background:#fff1ce;padding:12px;text-align:center;font:14px sans-serif' }, children: '验收环境 · AI 真实生成 · 使用测试回答，不计入正式学习记录', injectTo: 'body-prepend' }]; },
    }], server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { deny: ['**/.local/**', '.env', '.env.*'] } } });
    await preview.listen();
    console.log('隔离验收页面：http://127.0.0.1:5174/（Ctrl+C 关闭）');
    await new Promise(resolve => server.close(resolve));
    codex.close();
  } else await close();
} catch (error) {
  console.error('验收未通过：', error.message);
  await close(); process.exitCode = 1;
}
