import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../server/engine.js';
import { prompts, skills } from '../server/coach.js';

const config = { provider: 'compatible', apiKey: 'test-only' };
const task = id => ({ id, kind:'choice', skill:'语法', level:'A2', prompt:`${id}: Yesterday I ___ home.`, options:['went','go'], answer:'went', hint:'留意时间词', reason:'练习过去时', audio:'', passage:'' });
const feedback = explanation => ({ correct:true, explanation, suggestion:'', weakness:'' });
const report = summary => ({ level:'A2', summary, nextFocus:'把过去时肯定句改为否定句。', skills:skills.map(name=>({name,level:'A2',evidence:'已完成的作答。'})) });
const entry = (id,at) => ({id,task:task(id),answer:'went',feedback:feedback('went 与 yesterday 一致。'),at,askedAt:at,activeSeconds:20});
const round = (id,at) => ({id,goal:'四级',mode:'综合',targetCount:5,history:[entry(id,at)],startedAt:at,finishedAt:at,current:null,feedback:null,report:{...report(`旧小结 ${id}`),updatedAt:at}});

test('live summaries follow each answer and retain its concrete AI explanation', async()=>{
  let sequence = 0;
  const engine=createEngine({initialState:{version:1,config,sessions:[]},save:async()=>{},modelCall:async(c,p)=>{
    if(p===prompts.next) return task('first');
    return {feedback:feedback(++sequence === 1 ? '你正确使用 went 表达昨天发生的动作。' : '这次用 did 搭配动词原形，时态也准确。'),nextTask:task(`next-${sequence}`)};
  }});
  let session=(await engine.execute('/api/session/start',{goal:'高中英语',mode:'综合'})).sessions[0];
  let result=await engine.execute('/api/session/answer',{sessionId:session.id,taskId:session.current.id,answer:'went'});
  const first=result.profile.summary;
  assert.match(first,/went 表达昨天/);
  result=await engine.execute('/api/session/next',{sessionId:session.id,taskId:session.current.id});session=result.sessions[0];
  result=await engine.execute('/api/session/answer',{sessionId:session.id,taskId:session.current.id,answer:'went'});
  assert.notEqual(result.profile.summary,first);
  assert.match(result.profile.summary,/did 搭配动词原形/);
  assert.match(result.profile.summary,/next-1/);
  assert.doesNotMatch(result.profile.summary,/校准|已根据最近/);
});

test('refresh uses latest evidence across goals without rewriting archived rounds or personal plans',async()=>{
  const old=round('old','2026-11-10T10:00:00.000Z');
  const latest={...round('latest','2026-11-19T10:00:00.000Z'),goal:'日常英语',finishedAt:null,report:null};
  const initial={version:1,config,sessions:[latest,old],profile:{...report('旧内容'),updatedAt:old.finishedAt,learningPlans:{四级:{minutesPerDay:20}}}};
  const before=structuredClone(initial);
  const engine=createEngine({initialState:initial,save:async()=>{},modelCall:async(c,p,ctx)=>{
    assert.equal(p,prompts.report);assert.equal(ctx.overview,true);
    assert.equal(ctx.history.at(-1).id,'latest');assert.equal(ctx.recentHistory[0].id,'old');
    return report('你在最新一题中正确用了过去时。'.repeat(15));
  }});
  const result=await engine.execute('/api/profile/refresh',{}, {compact:true});
  assert.match(result.profile.summary,/最新一题/);
  assert.ok(result.profile.summary.length>140,'Compact state must not truncate the refreshed summary');
  assert.ok(result.profile.updatedAt);assert.equal(result.profile.live,undefined);
  assert.deepEqual(result.profile.learningPlans,before.profile.learningPlans);
  assert.deepEqual(engine.detail('old').history,before.sessions[1].history);
  assert.deepEqual(engine.detail('old').report,before.sessions[1].report);
  assert.equal(engine.detail('latest').finishedAt,null);
  assert.deepEqual(initial,before);
});

test('refresh failure retains the previous summary and never fabricates a result without answers',async()=>{
  const initial={version:1,config,sessions:[round('one','2026-11-10T10:00:00.000Z')],profile:report('保留的具体小结')};
  for(const failure of ['model','save']) {
    const engine=createEngine({initialState:structuredClone(initial),save:async()=>{if(failure==='save')throw Error('disk full');},modelCall:async()=>{if(failure==='model')throw Error('offline');return report('新小结');}});
    await assert.rejects(engine.execute('/api/profile/refresh',{}));
    assert.deepEqual(engine.profile().profile,initial.profile);
  }
  const empty=createEngine({initialState:{version:1,config,sessions:[]},save:async()=>{},modelCall:async()=>assert.fail('No model call without answers')});
  await assert.rejects(empty.execute('/api/profile/refresh',{}),/完成一道练习/);
});

test('explicit report regeneration uses the historical cutoff and preserves newer progress',async()=>{
  const old=round('old','2026-11-10T10:00:00.000Z'), newer=round('newer','2026-11-18T10:00:00.000Z');
  const initial={version:1,config,sessions:[old,newer],profile:newer.report};
  const before=structuredClone(initial);
  let calls=0;
  const engine=createEngine({initialState:initial,save:async()=>{},modelCall:async(c,p,ctx)=>{
    calls++;assert.equal(ctx.reportRecovery,true);assert.equal(ctx.reportAsOf,old.finishedAt);
    assert.ok(!JSON.stringify(ctx).includes('newer'));
    return report('你在这一轮正确用了 went，下一步练否定句。');
  }});
  await engine.execute('/api/session/report',{sessionId:'old'});assert.equal(calls,0);
  await engine.execute('/api/session/report',{sessionId:'old',regenerate:true});assert.equal(calls,1);
  assert.match(engine.detail('old').report.summary,/went/);
  assert.deepEqual(engine.detail('old').history,before.sessions[0].history);
  assert.equal(engine.detail('old').finishedAt,old.finishedAt);
  assert.deepEqual(engine.profile().profile,before.profile);
});
