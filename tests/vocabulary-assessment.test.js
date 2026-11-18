import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEngine } from '../server/engine.js';
import { exportBackup, planImport, validateBackup } from '../server/backup.js';
import { reconcile, recordsFromBackup, mergeCloudRecords } from '../server/sync-records.js';
import { wordbook } from '../server/vocabulary.js';
import { renderReadingPassage, renderWordbook } from '../src/reading-words.js';
import { predictionFixture } from './fixtures/exam-fixture.js';

const mark = { sessionId:'round-0', taskId:'task-entry-0-0', word:'plates', status:'learning' };
test('word marking saves immediately, deduplicates case, retains context and survives backup/cloud/restart',async()=>{
  let saved;const state=predictionFixture(), engine=createEngine({initialState:state,save:async s=>{saved=structuredClone(s);},modelCall:async()=>{throw Error('must not call AI');}});
  await engine.execute('/api/vocabulary/mark',{...mark,word:'Plates'});
  await engine.execute('/api/vocabulary/mark',mark);
  const backup=engine.backup(), synced=mergeCloudRecords({version:1,sessions:[]},recordsFromBackup(backup));
  for(const data of [saved,planImport({version:1,sessions:[]},backup).state,synced]){
    const items=createEngine({initialState:data,save:async()=>{}}).view({compact:true}).wordbook;
    assert.equal(items.length,1);assert.equal(items[0].word,'plates');assert.equal(items[0].count,1);assert.match(items[0].sources[0].context,/plates are on the table/);
  }
  assert.deepEqual(saved.sessions[0].history,state.sessions[0].history);
  await engine.execute('/api/vocabulary/status',{word:'plates',status:'mastered'});assert.equal(engine.view().wordbook[0].status,'mastered');
  await engine.execute('/api/vocabulary/status',{word:'plates',status:'removed'});assert.equal(engine.view().wordbook.length,0);
  await engine.execute('/api/vocabulary/mark',mark);assert.equal(engine.view().wordbook[0].status,'learning');
});

test('unsubmitted marks survive finish; invalid words and failed writes preserve the original state',async()=>{
  const state=predictionFixture(),round=state.sessions[0];round.finishedAt=null;round.current=structuredClone(round.history[0].task);round.current.id='current';round.history=[];
  let fail=false;const engine=createEngine({initialState:state,save:async()=>{if(fail)throw Error('disk full');}});
  await engine.execute('/api/vocabulary/mark',{...mark,taskId:'current'});
  fail=true;await assert.rejects(engine.execute('/api/vocabulary/status',{word:'plates',status:'removed'}),/disk full/);
  assert.equal(engine.view().wordbook.length,1);fail=false;
  await assert.rejects(engine.execute('/api/vocabulary/mark',{...mark,taskId:'current',word:'unrelated'}),/从阅读文章/);
  await engine.execute('/api/session/finish',{sessionId:round.id});
  assert.equal(engine.backup().data.sessions[0].unfinished.task.id,'current');assert.equal(engine.view().wordbook.length,1);
});

test('Chinese meanings are generated from source context, cached and merged independently of mastery/removal',async()=>{
  let calls=0,invalid=false;
  const engine=createEngine({initialState:predictionFixture(),save:async()=>{},modelCall:async(c,p,ctx)=>{
    calls++;assert.match(ctx.words[0].context,/plates are on the table/);
    return {definitions:ctx.words.map(item=>({word:item.word,meaning:invalid?'plates':'盘子；餐盘（plate 的复数）',translation:'盘子在餐桌上。'}))};
  }});
  await engine.execute('/api/vocabulary/mark',mark);
  invalid=true;await assert.rejects(engine.execute('/api/vocabulary/define',{words:['plates']}),/中文释义/);assert.equal(engine.view().wordbook.length,1);assert.equal(engine.view().wordbook[0].meaning,undefined);
  invalid=false;await engine.execute('/api/vocabulary/define',{words:['plates']});
  await engine.execute('/api/vocabulary/define',{words:['plates']});assert.equal(calls,2);
  const defined=engine.backup(),state=planImport({sessions:[]},defined).state;
  assert.equal(wordbook(state)[0].meaning,'盘子；餐盘（plate 的复数）');assert.equal(wordbook(state)[0].sources[0].translation,'盘子在餐桌上。');
  const stale=structuredClone(defined);delete stale.data.sessions[0].wordMarks[0].meaning;delete stale.data.sessions[0].wordMarks[0].translation;delete stale.data.sessions[0].wordMarks[0].definedAt;
  stale.data.sessions[0].wordMarks[0].status='mastered';stale.data.sessions[0].wordMarks[0].updatedAt='2027-01-01T00:00:00.000Z';
  const merged=reconcile(recordsFromBackup(defined)[0],recordsFromBackup(stale)[0]);
  assert.equal(wordbook({sessions:[merged.payload]})[0].status,'mastered');assert.match(wordbook({sessions:[merged.payload]})[0].meaning,/盘子/);
  await engine.execute('/api/vocabulary/mark',{...mark,status:'removed'});await engine.execute('/api/vocabulary/mark',mark);assert.match(engine.view().wordbook[0].meaning,/盘子/);
});

test('independent word changes merge without conflicting answers; newer removals survive stale sync/import',async()=>{
  const engine=createEngine({initialState:predictionFixture(),save:async()=>{}});
  await engine.execute('/api/vocabulary/mark',mark);
  const old=engine.backup(),a=structuredClone(old),b=structuredClone(old);
  a.data.sessions[0].wordMarks[0]={...mark,taskId:mark.taskId,word:'plates',status:'removed',updatedAt:'2027-01-01T00:00:00.000Z'};
  b.data.sessions[0].wordMarks.push({taskId:mark.taskId,word:'table',status:'learning',updatedAt:'2027-01-02T00:00:00.000Z'});
  const merged=reconcile(recordsFromBackup(a)[0],recordsFromBackup(b)[0]);
  assert.deepEqual(wordbook({sessions:[merged.payload]}).map(w=>w.word),['table']);
  const imported=planImport(a.data,b).state;assert.deepEqual(wordbook(imported).map(w=>w.word),['table']);
  for(const invalid of [false,{},[{word:'fake',taskId:mark.taskId,status:'learning',updatedAt:'today'}]]){const corrupt=structuredClone(old);corrupt.data.sessions[0].wordMarks=invalid;assert.throws(()=>validateBackup(corrupt));}
});

test('manual assessment works before summary with sparse evidence, is idempotent, and preserves the last result on failure',async()=>{
  const initial=predictionFixture();initial.sessions=initial.sessions.slice(0,1);initial.sessions[0].history=initial.sessions[0].history.slice(0,1);
  let mode='success',calls=0,context;const engine=createEngine({initialState:initial,save:async()=>{},modelCall:async(c,p,ctx)=>{calls++;context=ctx;if(mode==='network')throw Error('offline');return mode==='declined'?{probability:null,reason:'需要补充听力'}:{probability:12.23,reason:'样本少，初步估计'};}});
  const input={goal:'四级',requestId:randomUUID()};assert.equal(engine.view().examOutlook['四级'].canAssess,true);
  await engine.execute('/api/exam/assess',input);await engine.execute('/api/exam/assess',input);assert.equal(calls,1);assert.equal(context.history.length,1);assert.equal(context.evidence.ready,false);
  for(const state of [engine.backup().data,mergeCloudRecords({sessions:[]},recordsFromBackup(engine.backup()))])assert.equal(createEngine({initialState:state,save:async()=>{}}).view().examOutlook['四级'].estimate.probabilityText,'12.23%');
  mode='declined';await assert.rejects(engine.execute('/api/exam/assess',{...input,requestId:randomUUID()}),/需要补充听力/);
  mode='network';await assert.rejects(engine.execute('/api/exam/assess',{...input,requestId:randomUUID()}),/上次结果已保留/);
  assert.equal(engine.view().examOutlook['四级'].estimate.probabilityText,'12.23%');
  await assert.rejects(engine.execute('/api/exam/assess',{goal:'六级',requestId:randomUUID()}),/至少一道/);
});

test('passage keeps punctuation and escaped content, and book exposes filtered context without duplicate words',()=>{
  const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const html=renderReadingPassage({passage:"Plates, plates! Don't lose them. <script>",sessionId:'s',taskId:'t',marks:[{taskId:'t',word:'plates',status:'learning'}],esc});
  assert.equal((html.match(/class="reading-word marked"/g)||[]).length,2);assert.match(html,/data-word="don't"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/已标记 1/);
  const book=renderWordbook({data:{wordbook:[{word:'plates',status:'learning',count:1,sources:[{sessionId:'s',goal:'四级',context:'The plates.'}]}]},esc,button:()=>'',query:'PLAT',filter:'learning'});
  assert.match(book,/The plates/);
});
