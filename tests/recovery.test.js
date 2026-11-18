import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../server/engine.js';
import { prompts, skills } from '../server/coach.js';
import { exportBackup, planImport } from '../server/backup.js';
import { reconcile, recordsFromBackup, mergeCloudRecords } from '../server/sync-records.js';

const oldAt='2026-11-10T10:00:00.000Z', laterAt='2026-11-15T10:00:00.000Z';
const task=id=>({id:`task-${id}`,kind:'choice',skill:'语法',level:'A2',prompt:`Yesterday ${id} I ___ home.`,options:['went','go'],answer:'went',reason:'复习过去时',hint:'注意时间词',audio:'',passage:''});
const entry=(id,at)=>({id,at,askedAt:at,task:task(id),answer:'went',activeSeconds:20,feedback:{correct:true,explanation:'时态准确。',suggestion:'',weakness:''}});
const report=(level='A2')=>({level,summary:'根据已保存的回答整理。',nextFocus:'练习过去时否定句。',skills:skills.map(name=>({name,level,evidence:'已保存的作答证据。'}))});
const round=(id,at)=>({id,goal:'四级',mode:'综合',targetCount:5,startedAt:at,finishedAt:at,current:null,feedback:null,history:[entry(id,at)],report:null,reportError:'上次小结生成失败。'});
const config={provider:'compatible',apiKey:'test-only'};

test('a missing archived summary can be generated once without regrading answers or adding study time',async()=>{
  let calls=0, failSave=true;
  const engine=createEngine({initialState:{version:1,config,sessions:[round('old',oldAt)]},save:async()=>{if(failSave)throw Error('disk full');},modelCall:async(c,p,ctx)=>{calls++;assert.equal(p,prompts.report);assert.equal(ctx.history.length,1);return report();}});
  await assert.rejects(engine.execute('/api/session/report',{sessionId:'old'}),/disk full/);
  assert.equal(engine.detail('old').report,null);
  failSave=false;await engine.execute('/api/session/report',{sessionId:'old'});
  const saved=engine.detail('old');assert.equal(saved.report.level,'A2');assert.equal(saved.report.updatedAt,oldAt);assert.ok(saved.report.generatedAt);assert.equal(saved.reportError,undefined);
  assert.equal(saved.history.length,1);assert.equal(saved.history[0].activeSeconds,20);assert.equal(saved.finishedAt,oldAt);
  await engine.execute('/api/session/report',{sessionId:'old'});assert.equal(calls,2,'A repeated successful request is idempotent');
  assert.equal(engine.backup().data.sessions[0].report.generatedAt,saved.report.generatedAt);
});

test('retrying an old summary cannot use later answers or replace the newer learner profile',async()=>{
  const newer={...report('B2'),updatedAt:laterAt};
  const initialState={version:1,config,profile:newer,sessions:[round('old',oldAt),{...round('later',laterAt),report:newer}]};
  const engine=createEngine({initialState,save:async()=>{},modelCall:async(c,p,ctx)=>{assert.ok(!JSON.stringify(ctx).includes('task-later'));assert.notEqual(ctx.profile?.level,'B2');return report('A2');}});
  await engine.execute('/api/session/report',{sessionId:'old'});
  assert.equal(engine.profile().profile.level,'B2');assert.equal(engine.profile().profile.updatedAt,laterAt);assert.equal(engine.detail('old').report.level,'A2');
  assert.equal(engine.view({compact:true}).recommendations.四级.sourceSessionId,'later');
});

test('a failed report retry keeps the old record and current practice intact with a model-related error',async()=>{
  const active={...round('current',laterAt),finishedAt:null,current:task('current-next')};
  const engine=createEngine({initialState:{version:1,config,sessions:[round('old',oldAt),active]},save:async()=>{throw Error('Failed report must not write');},modelCall:async()=>{throw Error('unexpected upstream failure');}});
  await assert.rejects(engine.execute('/api/session/report',{sessionId:'old'}),/检查模型连接/);
  assert.equal(engine.detail('old').report,null);assert.equal(engine.detail('current').current.id,'task-current-next');
});

test('a generated summary merges through sync and duplicate backup import without replacing saved answers',()=>{
  const local=round('same',oldAt), remote={...local,report:{...report(),updatedAt:oldAt,generatedAt:laterAt}};delete remote.reportError;
  const state={version:1,sessions:[local]}, backup=exportBackup({version:1,sessions:[remote]});
  const pair=[{kind:'round',id:'same',payload:local},{kind:'round',id:'same',payload:remote}];
  const merged=reconcile(...pair);assert.equal(merged.payload.report?.level,'A2');
  assert.deepEqual(reconcile(pair[1],pair[0]).payload,merged.payload);
  for(const result of [mergeCloudRecords(state,recordsFromBackup(backup)),planImport(state,backup).state]){
    assert.equal(result.sessions[0].report?.level,'A2');assert.equal(result.sessions[0].reportError,undefined);assert.equal(result.sessions[0].history[0].answer,'went');
  }
  const altered=structuredClone(remote);altered.history[0].answer='go';altered.history[0].feedback={correct:false,explanation:'时态错误。',suggestion:'',weakness:'过去时'};
  assert.equal(reconcile(pair[0],{kind:'round',id:'same',payload:altered}),null);
});
