import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardData } from '../server/dashboard.js';
import { createEngine } from '../server/engine.js';

const entry = (id, correct = false, at = '2026-11-01T12:00:00Z') => ({ id, at, activeSeconds: 60,
  task: { id: `t${id}`, skill: '阅读', answer: 'A', options: ['A', 'B'] }, answer: 'B', feedback: { correct } });
const archive = () => Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, goal: '四级', mode: '综合',
  finishedAt: '2026-11-01T12:00:00Z', history: [entry(i)] }));
const makeEngine = (sessions, overrides = {}) => createEngine({ initialState: { sessions, profiles: {},
  backgrounds: [{ private: 'learner context' }], config: { provider: 'compatible', apiKey: 'test-only' } },
  save: async () => {}, modelCall: async () => ({ ok: true }), ...overrides });

test('activity lists every completed round in bounded pages across goals without answers or active rounds', () => {
  const sessions = archive();
  sessions[29].goal = '六级';
  sessions.push({ id: 'active', goal: '日常英语', history: [entry(99)] });
  const engine = makeEngine(sessions);
  const first = engine.activity(), second = engine.activity(20);
  assert.equal(first.total, 30); assert.equal(first.items.length, 20); assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 10); assert.equal(second.hasMore, false);
  assert.equal(first.items[0].goal, '六级');
  assert.deepEqual([...first.items, ...second.items].map(s => s.id), Array.from({ length: 30 }, (_, i) => `s${29-i}`));
  assert.equal(first.items[0].history, undefined); assert.equal(first.items[0].count, 1);
  assert.equal(first.items[0].seconds, 60); assert.equal(first.items[0].correct, 0);
  assert.equal(engine.activity(-1).offset, 0); assert.equal(engine.activity('Infinity').offset, 0);
  assert.deepEqual(engine.activity(100).items, []);
  assert.equal(makeEngine([]).activity().total, 0);
});

test('compact dashboard omits archive/background/secrets but detail and paginated mistakes remain available', () => {
  const sessions = archive();
  sessions.push({ id: 'active', goal: '六级', history: [], current: entry(31).task, prepared: { task: entry(32).task } });
  const engine = makeEngine(sessions), view = engine.view({ compact: true });
  assert.equal(view.sessions.length, 1);
  assert.equal(view.sessions[0].current.answer, undefined);
  assert.equal(view.sessions[0].prepared, undefined);
  assert.equal(view.sessions[0].nextReady, true);
  assert.equal(view.backgrounds, undefined);
  assert.equal(view.config.apiKey, undefined);
  assert.equal(view.totals.all.count, 30);
  assert.equal(view.recent.length, 5);
  assert.equal(engine.detail('s0').history[0].id, 0);
  assert.throws(() => engine.detail('missing'), /找不到/);
  const first = engine.review('四级'), second = engine.review('四级', 20);
  assert.equal(first.total, 30); assert.equal(first.items.length, 20); assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 10); assert.equal(second.hasMore, false);
  assert.deepEqual([...first.items, ...second.items].map(x => x.id), Array.from({ length: 30 }, (_, i) => 29-i));
  assert.equal(engine.review('六级').total, 0);
});

test('failed save rolls back active changes while archived rounds remain intact', async () => {
  const sessions = archive();
  sessions.push({ id: 'active', goal: '四级', history: [], current: null, feedback: null });
  const engine = makeEngine(sessions, { save: async () => { throw new Error('disk full'); } });
  const before = structuredClone(engine.view());
  await assert.rejects(engine.execute('/api/session/finish', { sessionId: 'active' }, { compact: true }), /disk full/);
  assert.deepEqual(engine.view(), before);
});

test('daily totals use learner timezone and seven distinct calendar days across DST', () => {
  const sessions = [{ id: 's1', goal: '四级', finishedAt: '2026-11-02', history: [entry(1, true, '2026-11-02T07:30:00Z')] }];
  const now = new Date('2026-11-02T08:30:00Z'); // 00:30 in Los Angeles after DST ends
  const { totals } = dashboardData({ sessions }, 'America/Los_Angeles', now);
  assert.deepEqual(totals.all.days.map(x => x.date), ['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02']);
  assert.equal(totals.all.days[5].count, 1); assert.equal(totals.all.days[6].count, 0);
  assert.equal(totals.all.correct, 1); assert.equal(totals.all.seconds, 60);
  assert.equal(dashboardData({ sessions }, 'Invalid/Zone', now).totals.all.days[6].count, 1);
});
