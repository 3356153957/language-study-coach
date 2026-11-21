import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardData } from '../server/dashboard.js';
import { createEngine } from '../server/engine.js';
import { renderDashboard, renderProfile } from '../src/dashboard.js';
import { predictionFixture } from './fixtures/exam-fixture.js';

const entry = (id, correct = false, at = '2026-11-01T12:00:00Z') => ({ id, at, activeSeconds: 60,
  task: { id: `t${id}`, skill: '阅读', answer: 'A', options: ['A', 'B'] }, answer: 'B', feedback: { correct } });
const archive = () => Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, goal: '四级', mode: '综合',
  finishedAt: '2026-11-01T12:00:00Z', history: [entry(i)] }));
const makeEngine = (sessions, overrides = {}) => createEngine({ initialState: { sessions, profiles: {},
  backgrounds: [{ private: 'learner context' }], config: { provider: 'compatible', apiKey: 'test-only' } },
  save: async () => {}, modelCall: async () => ({ ok: true }), ...overrides });

test('web prediction card and detail show the recovered midpoint and date instead of an empty accumulation state', () => {
  const initialState=predictionFixture(); delete initialState.examEstimates;
  const data=createEngine({initialState,save:async()=>{}}).view({compact:true});
  const args={data,goal:'四级',esc:String,button:()=>'',date:String};
  for(const html of [renderDashboard(args),renderProfile(args)]){
    assert.match(html,/45.00%/);assert.match(html,/2026-11-14/);assert.match(html,/历史区间中点/);
  }
  data.examOutlook['六级']={ready:true,progress:100,statusText:'等待学习小结',message:'完成六级学习小结后尝试预测。'};
  const html=renderDashboard({...args,goal:'六级'});
  assert.match(html,/完成六级学习小结/);assert.doesNotMatch(html,/完成四级小结/);
});

test('web prediction card and detail preserve decimal changes and fill the bar with the point estimate', () => {
  const initialState=predictionFixture();delete initialState.examEstimates;
  const older=structuredClone(initialState.sessions.at(-1).report);
  older.examEstimate={probability:11,reason:'此前依据'};
  initialState.sessions[3].report=older;initialState.sessions[3].finishedAt='2026-11-13';
  initialState.sessions[4].report.examEstimate={probability:12.23,reason:'新增依据'};
  const data=createEngine({initialState,save:async()=>{}}).view({compact:true});
  const args={data,goal:'四级',esc:String,button:()=>'',date:String};
  for(const html of [renderDashboard(args),renderProfile(args)]){
    assert.match(html,/12.23%/);assert.match(html,/较上次 \+1.23 个百分点/);assert.doesNotMatch(html,/undefined|NaN/);
  }
  assert.match(renderDashboard(args),/width:12.23%/);
});

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

test('empty dashboard uses compact pending styles and hides the due-review link until something is due', () => {
  const data = makeEngine([]).view({ compact: true });
  const button = (label, action) => `<button data-action="${action}">${label}</button>`;
  const html = renderDashboard({ data, goal: '四级', esc: String, button, date: String });
  assert.match(html, /<strong class="is-pending">待积累<\/strong>/);
  assert.match(html, /<strong class="exam-status is-pending">先积累练习记录<\/strong>/);
  assert.match(html, /0 个知识点到期复习/);
  assert.doesNotMatch(html, /查看到期复习/);
  assert.match(renderProfile({ data, goal: '四级', esc: String, button, date: String }), /<span class="progress-level is-pending">待积累<\/span>/);
});

test('due reviews keep the shortcut and a measured level keeps the large display style', () => {
  const data = makeEngine([]).view({ compact: true });
  data.reviews = { ...(data.reviews || {}), 四级: { dueCount: 2, scheduledCount: 2, items: [] } };
  data.profile = { ...(data.profile || {}), level: 'B1', skills: [] };
  const button = (label, action) => `<button data-action="${action}">${label}</button>`;
  const html = renderDashboard({ data, goal: '四级', esc: String, button, date: String });
  assert.match(html, /查看到期复习/);
  assert.match(html, /<strong class="">B1<\/strong>/);
});
