import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedProfile, examOutlook } from '../server/profile.js';
import { validateTask, validateReport } from '../server/coach.js';

test('legacy profiles merge into one latest profile without losing previously assessed skills', () => {
  const state = { profiles: { 四级: { level: 'A2', updatedAt: '2026-11-10', skills: [{ name: '听力', level: 'A2', evidence: '听力证据' }] }, 初中英语: { level: 'B1', updatedAt: '2026-11-11', skills: [{ name: '听力', level: '未测评', evidence: '' }, { name: '阅读', level: 'B1', evidence: '阅读证据' }] } } };
  const before = structuredClone(state);
  const profile = sharedProfile(state);
  assert.equal(profile.level, 'B1');
  assert.equal(profile.skills.find(s => s.name === '听力').level, 'A2');
  assert.equal(profile.skills.find(s => s.name === '阅读').level, 'B1');
  assert.deepEqual(state, before);
  state.profile = { ...profile, level: 'B2' };
  assert.equal(sharedProfile(state).level, 'B2');
});

test('writing and reading enforce actual task content, not just renamed buttons', () => {
  const task = { kind: 'text', skill: '表达', level: 'A2', reason: '练习表达', prompt: 'Describe your day.', passage: '', audio: '', options: [], answer: 'I read a book.', hint: '想想做过的事。' };
  assert.equal(validateTask(task, { mode: '写作', history: [] }).skill, '表达');
  assert.throws(() => validateTask(task, { mode: '阅读', history: [] }), /练习方式/);
  const reading = { ...task, skill: '阅读', passage: 'Mia read a book at home.', prompt: 'Where did Mia read?', answer: 'At home.' };
  assert.equal(validateTask(reading, { mode: '阅读', history: [] }).skill, '阅读');
  assert.throws(() => validateTask({ ...reading, passage: '' }, { mode: '阅读', history: [] }), /完整/);
  assert.throws(() => validateTask(reading, { mode: '写作', history: [] }), /练习方式/);
});

test('exam estimates stay target-specific and historical results survive a changing evidence window', () => {
  const entries = Array.from({ length: 24 }, (_, i) => ({ task: { skill: ['阅读', '听力', '表达'][i % 3] }, hintUsed: false, transcriptViewed: false }));
  const state = { sessions: [{ goal: '四级', history: entries }], examEstimates: { 四级: { low: 30, high: 60, reason: '示例' } } };
  assert.equal(examOutlook(state)['四级'].estimate.high, 60);
  assert.equal(examOutlook(state)['六级'].estimate, null);
  entries.forEach(e => { e.hintUsed = true; });
  assert.equal(examOutlook(state)['四级'].estimate.high, 60);
  assert.equal(examOutlook(state)['四级'].status, 'historical');
  assert.equal(examOutlook(state)['四级'].count, 0);
});

test('latest valid archived prediction wins over stale cache and newer empty reports', () => {
  const report = (date, goal, estimate) => ({ goal, finishedAt: date, history: [], report: { examEstimate: estimate } });
  const state = { sessions: [
    report('2026-11-14', '四级', { low: 40, high: 70, reason: '较新的四级依据' }),
    report('2026-11-13', '四级', { low: 20, high: 50, reason: '较早的依据' }),
    report('2026-11-15', '四级', null),
    report('2026-11-16', '六级', { low: 10, high: 40, reason: '六级依据' }),
    report('2026-11-17', '四级', { low: 80, high: 81, reason: '无效区间' }),
  ], examEstimates: { 四级: { low: 20, high: 50, reason: '旧缓存', updatedAt: '2026-11-13' } } };
  const before = structuredClone(state), outlook = examOutlook(state);
  assert.equal(outlook['四级'].estimate.high, 70);
  assert.equal(outlook['四级'].estimate.updatedAt, '2026-11-14T00:00:00.000Z');
  assert.equal(outlook['六级'].estimate.high, 40);
  assert.deepEqual(state, before);
});

test('eligible samples distinguish waiting for a summary from a summary without a valid estimate', () => {
  const history = Array.from({ length: 24 }, (_, i) => ({ task: { skill: ['阅读', '听力', '表达'][i % 3] } }));
  const round = { goal: '六级', history };
  const state = { sessions: [round] };
  assert.equal(examOutlook(state)['六级'].status, 'awaiting_summary');
  assert.match(examOutlook(state)['六级'].message, /六级.*小结/);
  round.finishedAt = '2026-11-16'; round.report = { examEstimate: null };
  assert.equal(examOutlook(state)['六级'].status, 'no_estimate');
  assert.match(examOutlook(state)['六级'].message, /未给出有效区间/);
  assert.equal(examOutlook(state)['四级'].status, 'collecting');
});

test('malformed or overly precise probability estimates do not discard a valid learning report', () => {
  const report = { level: 'A2', summary: '学习观察', nextFocus: '继续练习', skills: ['阅读', '听力', '词汇', '语法', '表达'].map(name => ({ name, level: 'A2', evidence: '样例' })) };
  for (const e of [{ low: -1, high: 50, reason: '错误' }, { low: 40, high: 41, reason: '过窄' }, { low: '30', high: 60, reason: '错误' }]) assert.equal(validateReport({ ...report, examEstimate: e }).examEstimate, null);
  assert.deepEqual(validateReport({ ...report, examEstimate: { low: 30, high: 60, reason: '样例证据' } }).examEstimate, { low: 30, high: 60, reason: '样例证据' });
});
