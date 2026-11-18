import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask, prompts } from '../server/coach.js';
import { repairOpenTask } from '../server/question-layout.js';
import { createEngine } from '../server/engine.js';
import { exportBackup } from '../server/backup.js';
import { renderLearningChat } from '../src/chat.js';

const base = { id: 'old-task', kind: 'text', skill: '表达', level: 'A2', reason: '练习过去时',
  prompt: '请将以下内容写成两句完整的英语：\n① 昨天上午我归还了一本词典。\n② 我没有借其他书。\n可用词语：return a dictionary / borrow any other books。\n请保留完整时间信息，并给每句加上句号。',
  options: [], audio: '', passage: '', answer: "Yesterday morning, I returned a dictionary. I did not borrow any other books.", hint: '注意过去时。' };

test('numbered translation prompts produce one field per sentence and keep shared instructions', () => {
  const task = validateTask(base, { mode: '写作', history: [] });
  assert.equal(task.questions.length, 2);
  assert.equal(task.questions[0].prompt, '昨天上午我归还了一本词典。');
  assert.equal(task.questions[1].prompt, '我没有借其他书。');
  assert.equal(task.questions[1].answer, 'I did not borrow any other books.');
  assert.match(task.prompt, /可用词语/);
  assert.doesNotMatch(task.prompt, /①|②/);
  assert.equal(base.questions, undefined);
  const inline = validateTask({ ...base, prompt: '请分别表达：①昨天归还词典。②没有借其他书。' }, { mode: '写作', history: [] });
  assert.equal(inline.questions.length, 2);
  assert.throws(() => validateTask({ ...base, answer: 'Only one reference.' }, { mode: '写作', history: [] }), /对应参考答案/);
});

test('one paragraph remains one field while explicit 1–4 questions produce exactly 1–4 fields', () => {
  assert.equal(repairOpenTask({ ...base, prompt: '写一段连贯短文，包含以下内容：\n① 昨天归还词典。\n② 没借其他书。' }).questions, undefined);
  for (const count of [1, 2, 3, 4]) {
    const questions = Array.from({ length: count }, (_, i) => ({ prompt: `Write sentence ${i + 1}.`, options: [], answer: 'I read.' }));
    const task = validateTask({ ...base, prompt: '请分别回答。', questions }, { mode: '写作', history: [] });
    const session = { id: 'session', goal: '四级', mode: '写作', targetCount: 5, history: [], current: task };
    const html = renderLearningChat({ session, draft: {}, esc: String, button: (label, action, cls, attrs = '') => `<button data-action="${action}" ${attrs}>${label}</button>` });
    assert.equal((html.match(/<textarea /g) || []).length, count);
    assert.match(html, /换行/);
    assert.equal((html.match(/data-action="answer-next-field"/g) || []).length, count - 1);
  }
  assert.match(prompts.next, /避免连续重复/);
});

test('a saved unstructured current task exposes fields, accepts grouped answers and keeps old archives portable', async () => {
  const initialState = { version: 1, config: { provider: 'compatible', apiKey: 'test-only' }, profiles: {}, sessions: [{
    id: 'active', goal: '四级', mode: '写作', targetCount: 1, startedAt: '2026-11-16T00:00:00Z', history: [], current: base,
  }] };
  const engine = createEngine({ initialState, save: async () => {}, modelCall: async () => ({ correct: true, explanation: '两项已回答。', suggestion: '', weakness: '', questions:[0,1].map(()=>({correct:true,explanation:'本项已回答。',suggestion:'',weakness:''})) }) });
  const current = engine.view({ compact: true }).sessions[0].current;
  assert.equal(current.questions.length, 2);
  assert.equal(current.questions[0].answer, undefined);
  assert.equal(initialState.sessions[0].current.questions, undefined);
  const result = await engine.execute('/api/session/answer', { sessionId: 'active', taskId: base.id, answer: '["I returned a dictionary.","I did not borrow other books."]' });
  assert.equal(result.sessions[0].history[0].task.questions.length, 2);

  const archive = { ...initialState.sessions[0], id: 'archive', finishedAt: '2026-11-16T01:00:00Z', current: null, history: [{
    id: 'entry', task: base, answer: 'I returned a dictionary. I did not borrow other books.',
    feedback: { correct: true, explanation: '原记录', suggestion: '', weakness: '' }, at: '2026-11-16T00:10:00Z',
  }] };
  const backup = exportBackup({ version: 1, sessions: [archive] });
  assert.equal(backup.data.sessions[0].history[0].task.questions, null);
  assert.equal(backup.data.sessions[0].history[0].answer, archive.history[0].answer);
});


test('an explicit single question accepts its own reference and retains shared instructions',()=>{
  const value=validateTask({...base,prompt:'Use the past tense and retain all details.',answer:'',questions:[{prompt:'What did you do yesterday?',options:[],answer:'I returned a dictionary.'}]},{mode:'写作',history:[]});
  assert.equal(value.questions.length,1);assert.equal(value.answer,'I returned a dictionary.');assert.equal(value.prompt,'Use the past tense and retain all details.');
});

test('shared instruction text does not reject a different question but unchanged content is still rejected',()=>{
  const raw={...base,prompt:'Answer the following questions.',answer:'',questions:[{prompt:'What did you eat yesterday?',options:[],answer:'I ate rice.'}]};
  const first=validateTask(raw,{mode:'写作',history:[]});
  const session={mode:'写作',history:[{task:first}]};
  assert.throws(()=>validateTask(raw,session),/重复/);
  assert.equal(validateTask({...raw,questions:[{prompt:'What did you read yesterday?',options:[],answer:'I read a book.'}]},session).questions.length,1);
});
