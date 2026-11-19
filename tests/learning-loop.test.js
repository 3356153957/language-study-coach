import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../server/engine.js';
import { prompts, skills } from '../server/coach.js';
import { exportBackup, planImport } from '../server/backup.js';
import { recordsFromBackup, mergeCloudRecords, reconcile } from '../server/sync-records.js';
import { reviewPlan } from '../server/review-plan.js';
import { learningProgress } from '../server/learning-progress.js';
import { validateLearningPlan } from '../server/learning-plan.js';

const task = n => ({ id:`task-${n}`, kind:'choice', skill:'语法', level:'A2', prompt:`Task ${n}: Yesterday I ___ home.`, options:['went','go'], answer:'went', hint:'注意时间。', reason:'复习过去时', audio:'', passage:'' });
const feedback = correct => ({ correct, explanation:correct?'回答正确。':'应使用过去时。', suggestion:'', weakness:correct?'':'一般过去时' });
const entry = (id, at, correct=false, extra={}) => ({id,at,askedAt:at,task:task(id),answer:correct?'went':'go',feedback:feedback(correct),...extra});
const round = (id, history, extra={}) => ({id,goal:'高中英语',mode:'综合',targetCount:5,startedAt:history[0].at,finishedAt:history.at(-1).at,history,current:null,...extra});
const config = {provider:'compatible',apiKey:'test-only'};

test('personal plans survive grading, reports, backup and cloud restore and reach the tutor for the selected goal', async()=>{
  let saved, lastContext, sequence=0;
  const engine=createEngine({initialState:{version:1,config,sessions:[]},save:async value=>{saved=structuredClone(value);},modelCall:async(c,p,ctx)=>{
    lastContext=ctx;
    if(p===prompts.next)return task(++sequence);
    if(p===prompts.report)return {level:'A2',summary:'基于本轮作答。',nextFocus:'再练过去时。',skills:skills.map(name=>({name,level:'A2',evidence:'作答依据。'})),learningPlans:{高中英语:{minutesPerDay:120,scenario:'模型不应替换用户安排',updatedAt:new Date().toISOString()}}};
    return {feedback:feedback(true),nextTask:task(++sequence)};
  }});
  await engine.execute('/api/learning-plan',{goal:'高中英语',minutesPerDay:10,targetDate:'2026-12-20',scenario:'高中英语阅读长句'});
  let s=(await engine.execute('/api/session/start',{goal:'高中英语',mode:'综合'})).sessions[0];
  assert.equal(lastContext.learningPlan.minutesPerDay,10);assert.equal(lastContext.learningPlan.scenario,'高中英语阅读长句');
  await engine.execute('/api/session/answer',{sessionId:s.id,taskId:s.current.id,answer:'went'});
  await engine.execute('/api/session/finish',{sessionId:s.id});
  assert.equal(engine.profile().profile.learningPlans.高中英语.minutesPerDay,10);
  const backup=exportBackup(saved);
  const imported=planImport({version:1,sessions:[]},backup).state;
  const synced=mergeCloudRecords({version:1,sessions:[]},recordsFromBackup(backup));
  for(const state of [imported,synced])assert.equal(state.profile.learningPlans.高中英语.scenario,'高中英语阅读长句');
  await engine.execute('/api/session/start',{goal:'日常英语',mode:'综合'});assert.equal(lastContext.learningPlan,null);
  for(const input of [{minutesPerDay:0},{minutesPerDay:200},{minutesPerDay:20,targetDate:'2026-02-30'}])assert.throws(()=>validateLearningPlan(input));
});

test('a recommendation starts the actual recommended topic and backup retains its source', async()=>{
  const source=round('source',[entry('seed','2026-11-14T10:00:00Z')],{report:{level:'A2',summary:'过去时需巩固。',nextFocus:'否定句 did not + 动词原形。',skills:skills.map(name=>({name,level:'A2',evidence:'历史作答。'}))}});
  const engine=createEngine({initialState:{version:1,config,sessions:[source]},save:async()=>{},modelCall:async(c,p,ctx)=>{assert.equal(ctx.recommendedFocus.text,source.report.nextFocus);return task('new');}});
  const s=(await engine.execute('/api/session/start',{goal:'高中英语',mode:'综合',recommendationId:source.id})).sessions.at(-1);
  assert.equal(s.focus.sourceSessionId,source.id);
  assert.equal(engine.backup().data.sessions.at(-1).focus.text,source.report.nextFocus);
});

test('home recommendations remain specific to the selected goal',async()=>{
  const cet=round('cet',[entry('a','2026-11-13T10:00:00Z')],{report:{nextFocus:'高中英语阅读长句'}});
  const daily=round('daily',[entry('b','2026-11-14T10:00:00Z')],{goal:'日常英语',report:{nextFocus:'餐厅点餐'}});
  let context;
  const engine=createEngine({initialState:{version:1,config,sessions:[cet,daily]},save:async()=>{},modelCall:async(c,p,ctx)=>{context=ctx;return task('next');}});
  assert.equal(engine.view({compact:true}).recommendations.高中英语.text,'高中英语阅读长句');
  await engine.execute('/api/session/start',{goal:'高中英语',mode:'综合',useProfileFocus:true});assert.equal(context.recommendedFocus.text,'高中英语阅读长句');
});

test('reviews use actual linked attempts, separate days and assistance to schedule 1/3/7/14 day intervals',()=>{
  const initial=entry('wrong','2026-10-30T18:00:00Z');
  const state={sessions:[round('one',[initial])]};
  const inspect=now=>reviewPlan(state,'America/Los_Angeles',new Date(now))[0];
  assert.equal(inspect('2026-10-30T20:00:00Z').dueDate,'2026-10-31');
  const add=(id,at,correct=true,extra={})=>state.sessions.push(round(id,[entry(id,at,correct,{reviewOf:initial.id,...extra})]));
  add('same','2026-10-30T20:00:00Z');assert.equal(inspect('2026-10-30T21:00:00Z').streak,0);
  add('first','2026-10-31T18:00:00Z');assert.equal(inspect('2026-10-31T20:00:00Z').dueDate,'2026-11-03');
  add('assisted','2026-11-03T18:00:00Z',true,{hintUsed:true});assert.equal(inspect('2026-11-03T20:00:00Z').streak,1);
  add('second','2026-11-04T18:00:00Z');assert.equal(inspect('2026-11-04T20:00:00Z').dueDate,'2026-11-11');
  add('third','2026-11-11T18:00:00Z');assert.equal(inspect('2026-11-11T20:00:00Z').streak,3);assert.equal(inspect('2026-11-11T20:00:00Z').dueDate,'2026-11-25');
  add('again','2026-11-25T18:00:00Z',false);assert.equal(inspect('2026-11-25T20:00:00Z').streak,0);
  state.sessions.push(round('chained',[entry('chained','2026-11-26T18:00:00Z',true,{reviewOf:'again'})]));
  assert.equal(inspect('2026-11-26T20:00:00Z').streak,1);
  assert.equal(reviewPlan(state,'America/Los_Angeles',new Date('2026-11-25T20:00:00Z')).length,1);
});

test('review start marks only its first answer as related and preserves the link in portable records',async()=>{
  const seed=entry('wrong','2026-11-10T10:00:00Z');let next=0;
  const engine=createEngine({initialState:{version:1,config,sessions:[round('old',[seed])]},save:async()=>{},modelCall:async(c,p,ctx)=>{assert.equal(ctx.review.id,seed.id);return p===prompts.next ? task(++next):{feedback:feedback(true),nextTask:task(++next)};}});
  let s=(await engine.execute('/api/session/start',{goal:'高中英语',mode:'综合',reviewId:seed.id})).sessions.at(-1);
  s=(await engine.execute('/api/session/answer',{sessionId:s.id,taskId:s.current.id,answer:'went'})).sessions.at(-1);
  assert.equal(s.history[0].reviewOf,seed.id);
  const portable=engine.backup().data.sessions.at(-1);assert.equal(portable.reviewId,seed.id);assert.equal(portable.history[0].reviewOf,seed.id);
});

test('progress compares same-level unaided answers and withholds changes when either period lacks evidence',()=>{
  const history=[];
  for(let i=0;i<5;i++)history.push(entry(`old-${i}`,'2026-11-05T10:00:00Z'));
  for(let i=0;i<5;i++)history.push(entry(`new-${i}`,'2026-11-15T10:00:00Z',true));
  history.push(entry('hint','2026-11-15T10:00:00Z',false,{hintUsed:true}));
  history.push(entry('easy','2026-11-15T10:00:00Z',false,{task:{...task('easy'),level:'A1'}}));
  const profile={skills:[{name:'语法',level:'A2'}]};
  const result=learningProgress({sessions:[round('periods',history)]},profile,'UTC',new Date('2026-11-16T12:00:00Z'));
  const row=result.comparisons.find(row=>row.name==='语法');assert.equal(row.recent.count,5);assert.equal(row.previous.count,5);assert.equal(row.change,100);
  assert.equal(result.comparisons.find(row=>row.name==='听力').change,null);
  const short=learningProgress({sessions:[round('short',history.slice(5))]},profile,'UTC',new Date('2026-11-16T12:00:00Z'));
  assert.equal(short.comparisons.find(row=>row.name==='语法').change,null);
});

test('switch prepares the new exercise before closing the old one, preserves an ungraded draft and discussions, and rolls back failures',async()=>{
  let failModel=true, failSave=false, saved, sequence=0;
  const old={id:'active',goal:'高中英语',mode:'综合',targetCount:5,startedAt:'2026-11-15T10:00:00Z',history:[entry('done','2026-11-15T10:00:00Z',true)],current:task('pending'),feedback:null,discussions:{'task-pending':[{id:'turn',message:'为什么用过去时？',reply:'观察时间词。',at:'2026-11-15T11:00:00Z'}]}};
  const engine=createEngine({initialState:{version:1,config,sessions:[old]},save:async value=>{if(failSave)throw Error('disk full');saved=value;},modelCall:async(c,p)=>{
    assert.equal(p,prompts.next,'Switch never waits on a summary');if(failModel)throw Error('offline');return {...task(++sequence),skill:'阅读',passage:'I went home yesterday.'};
  }});
  const input={goal:'初中英语',mode:'阅读',replaceSessionId:'active',draftTaskId:'task-pending',draftAnswer:'go'};
  await assert.rejects(engine.execute('/api/session/start',input),/offline/);
  assert.equal(engine.detail('active').finishedAt,undefined);assert.equal(engine.detail('active').current.id,'task-pending');
  failModel=false;failSave=true;
  await assert.rejects(engine.execute('/api/session/start',input),/disk full/);assert.equal(engine.detail('active').finishedAt,undefined);
  failSave=false;const result=await engine.execute('/api/session/start',input);
  assert.equal(result.sessions.filter(s=>!s.finishedAt).length,1);assert.equal(result.sessions.at(-1).mode,'阅读');
  assert.equal(engine.detail('active').unfinished.answer,'go');assert.equal(engine.detail('active').history.length,1);
  const portable=exportBackup(saved);assert.equal(portable.data.sessions[0].unfinished.answer,'go');assert.equal(portable.data.sessions[0].discussions['task-pending'][0].message,'为什么用过去时？');
  const restored=planImport({version:1,sessions:[]},portable).state;assert.equal(restored.sessions[0].unfinished.task.id,'task-pending');
  await assert.rejects(engine.execute('/api/session/start',input),/变更/);
});

test('finishing an unanswered discussed task preserves it without inventing a score',async()=>{
  const current=task('unsent');
  const engine=createEngine({initialState:{version:1,config,sessions:[{id:'active',goal:'高中英语',mode:'综合',targetCount:5,startedAt:new Date().toISOString(),history:[],current,discussions:{[current.id]:[{id:'turn',message:'能讲下用法吗？',reply:'可以。',at:new Date().toISOString()}]}}]},save:async()=>{},modelCall:async()=>{throw Error('Must not grade an unfinished draft');}});
  await engine.execute('/api/session/finish',{sessionId:'active',draftTaskId:current.id,draftAnswer:'go'});
  const backup=engine.backup();assert.equal(backup.data.sessions[0].history.length,0);assert.equal(backup.data.sessions[0].unfinished.answer,'go');assert.equal(backup.data.sessions[0].discussions[current.id].length,1);
});

test('newer capability reports and separate goal plans merge without losing user arrangements',()=>{
  const makePlan=(minutes,at)=>({minutesPerDay:minutes,scenario:'安排',targetDate:'',updatedAt:at});
  const local={level:'A2',summary:'画像',nextFocus:'练习',skills:skills.map(name=>({name,level:'A2',evidence:'记录'})),updatedAt:'2026-11-16T12:00:00.000Z',learningPlans:{高中英语:makePlan(15,'2026-11-16T12:00:00.000Z')}};
  const remote={...local,updatedAt:'2026-11-16T13:00:00.000Z',learningPlans:{高中英语:makePlan(20,'2026-11-15T12:00:00.000Z'),日常英语:makePlan(10,'2026-11-16T13:00:00.000Z')}};
  const merged=reconcile({kind:'profile',id:'learner',payload:local},{kind:'profile',id:'learner',payload:remote}).payload;
  assert.equal(merged.learningPlans.高中英语.minutesPerDay,15);assert.equal(merged.learningPlans.日常英语.minutesPerDay,10);
  const state={version:1,profile:local,sessions:[]},portable=exportBackup({version:1,profile:remote,sessions:[]});
  for(const profile of [mergeCloudRecords(state,recordsFromBackup(portable)).profile,planImport(state,portable).state.profile]){
    assert.equal(profile.learningPlans.高中英语.minutesPerDay,15);assert.equal(profile.learningPlans.日常英语.minutesPerDay,10);
  }
});
