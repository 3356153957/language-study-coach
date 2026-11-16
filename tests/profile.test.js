import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedProfile, examOutlook } from '../server/profile.js';
import { validateTask, validateReport, validateExamEstimate, prompts } from '../server/coach.js';

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
  assert.match(examOutlook(state)['六级'].message, /未给出有效预测/);
  assert.equal(examOutlook(state)['四级'].status, 'collecting');
});

test('malformed estimates do not discard a valid learning report and legacy ranges remain portable', () => {
  const report = { level: 'A2', summary: '学习观察', nextFocus: '继续练习', skills: ['阅读', '听力', '词汇', '语法', '表达'].map(name => ({ name, level: 'A2', evidence: '样例' })) };
  for (const e of [{ low: -1, high: 50, reason: '错误' }, { low: 40, high: 41, reason: '过窄' }, { low: '30', high: 60, reason: '错误' }]) assert.equal(validateReport({ ...report, examEstimate: e }).examEstimate, null);
  assert.deepEqual(validateReport({ ...report, examEstimate: { low: 30, high: 60, reason: '样例证据' } }).examEstimate, { low: 30, high: 60, reason: '样例证据' });
});

test('point predictions accept decimals, normalize precision and reject invalid percentages', () => {
  for (const probability of [0, 0.23, 12.23, 100]) assert.equal(validateExamEstimate({ probability, reason: '依据' }).probability, probability);
  assert.equal(validateExamEstimate({ probability: 12.235, reason: '依据' }).probability, 12.24);
  for (const probability of [-0.01, 100.01, NaN, Infinity, '12.23', null, undefined]) {
    assert.equal(validateExamEstimate({ probability, low: 30, high: 60, reason: '依据' }), null);
  }
  assert.equal(validateExamEstimate({ probability: 12.23, reason: ' ' }), null);
  assert.match(prompts.report, /probability.*两位小数/);
  assert.doesNotMatch(prompts.report, /区间至少宽20/);
});

test('outlook shows two decimals and compares separate reports without counting the cache twice', () => {
  const round = (id, date, estimate, goal = '四级') => ({ id, goal, finishedAt: date, history: [], report: { examEstimate: estimate } });
  const old = { probability: 11, reason: '上次依据' }, latest = { probability: 12.23, reason: '新增依据' };
  const state = { sessions: [round('old', '2026-11-13', old), round('new', '2026-11-14', latest), round('six', '2026-11-15', { probability: 90, reason: '六级' }, '六级')],
    examEstimates: { 四级: { ...latest, updatedAt: '2026-11-13T23:59:59.999Z' } } };
  const before = structuredClone(state), value = examOutlook(state)['四级'];
  assert.equal(value.estimate.probabilityText, '12.23%');
  assert.equal(value.previous.probability, 11);
  assert.equal(value.change, 1.23); assert.equal(value.changeText, '较上次 +1.23 个百分点');
  assert.deepEqual(state, before);
  state.sessions.push(round('empty', '2026-11-16', null));
  assert.equal(examOutlook(state)['四级'].change, 1.23);
  state.sessions.push(round('flat', '2026-11-17', latest));
  assert.equal(examOutlook(state)['四级'].changeText, '较上次持平');
  state.sessions.push(round('drop', '2026-11-18', { probability: 10, reason: '新表现' }));
  assert.equal(examOutlook(state)['四级'].changeText, '较上次 −2.23 个百分点');
});

test('legacy range displays its midpoint without mutating history or fabricating a comparison', () => {
  const estimate = { low: 15, high: 40, reason: '历史依据' };
  const state = { sessions: [{ goal: '四级', finishedAt: '2026-11-14T00:00:00.005Z', history: [], report: { examEstimate: estimate } }],
    examEstimates: { 四级: { ...estimate, updatedAt: '2026-11-14' } } };
  const value = examOutlook(state)['四级'];
  assert.equal(value.estimate.probabilityText, '27.50%');
  assert.match(value.estimate.sourceNote, /历史区间中点/);
  assert.equal(value.change, null); assert.equal(value.changeText, '');
  assert.deepEqual(estimate, { low: 15, high: 40, reason: '历史依据' });
});
