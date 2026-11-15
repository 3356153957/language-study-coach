import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBackup, planImport, validateBackup } from '../server/backup.js';
import { createEngine } from '../server/engine.js';
import { createNativeClient } from '../src/native-client.js';

const at='2026-11-15T10:00:00.000Z';
const task=id=>({id,kind:'choice',skill:'语法',level:'A2',reason:'复习',prompt:`Yesterday ${id}`,options:['went','go'],answer:'went',hint:'注意时态',audio:'',passage:''});
const entry=id=>({id,task:task(`t-${id}`),answer:'go',feedback:{correct:false,explanation:'过去式',suggestion:'',weakness:'时态'},activeSeconds:20,at,askedAt:at});
const round=(id,finished=true)=>({id,goal:'四级',mode:'综合',targetCount:5,startedAt:at,history:[entry(id)],finishedAt:finished?at:null,current:finished?null:task(`next-${id}`),feedback:null});
const state=(sessions=[])=>({version:1,config:{apiKey:'secret-api',provider:'openai'},chatgpt:{refresh_token:'secret-oauth'},sessions});

test('backup roundtrip whitelists learning data, keeps discussions and current progress, omits credentials',()=>{
 const s=state([round('done'),round('active',false)]);s.sessions[0].discussions={'t-done':[{id:'discussion',message:'为什么',reply:'过去时',at}]};
 s.sessions[0].history[0].source={apiKey:'nested-secret'};
 const b=exportBackup(s);assert.equal(b.data.sessions.length,2);assert.equal(b.data.sessions[0].discussions['t-done'][0].reply,'过去时');
 assert.equal(JSON.stringify(b).includes('secret'),false);
 const merged=planImport(state(),b);assert.equal(merged.summary.added,2);assert.equal(merged.state.config.apiKey,'secret-api');assert.equal(merged.state.sessions[1].current.id,'next-active');
 assert.equal(planImport(merged.state,b).summary.added,0);
});

test('imports preserve active round and local answers on conflict; newer completed prefixes can merge',()=>{
 const local=state([round('same'),round('local',false)]),remote=state([round('same'),round('other',false)]);
 remote.sessions[0].history.push(entry('new'));
 const merged=planImport(local,exportBackup(remote));
 assert.equal(merged.summary.updated,1);assert.equal(merged.summary.conflicts,1);assert.equal(merged.state.sessions.filter(s=>!s.finishedAt)[0].id,'local');
 remote.sessions[0].history[0].answer='went';remote.sessions[0].history[0].feedback={correct:true,explanation:'正确',suggestion:'',weakness:''};
 assert.equal(planImport(local,exportBackup(remote)).state.sessions[0].history[0].answer,'go');
});

test('invalid schemas, duplicate ids, missing current tasks and corrupt grading reject before writes',async()=>{
 const b=exportBackup(state([round('done')]));
 for(const change of [b=>b.version=2,b=>b.data.sessions.push(b.data.sessions[0]),b=>b.data.sessions[0].history[0].feedback.correct=true,b=>{b.data.sessions[0].finishedAt=null;}]) {
  const broken=structuredClone(b);change(broken);assert.throws(()=>validateBackup(broken),/格式无效/);
 }
 let saves=0;const engine=createEngine({initialState:state(),save:async()=>{saves++;throw new Error('disk full');}});
 await assert.rejects(engine.execute('/api/data/import',{backup:b},{compact:true}),/disk full/);assert.equal(saves,1);assert.equal(engine.activity().total,0);
});

test('native import/export survives restart without replacing the phone API key',async()=>{
 let value;const store={load:async()=>({value}),save:async v=>{value=v.value;}};
 const client=await createNativeClient({store,compact:true});
 await client.request('settings',{provider:'openai',model:'test',apiKey:'phone-secret'});
 const backup=exportBackup(state([round('done')]));
 assert.equal((await client.request('data/preview',{backup})).added,1);
 assert.equal((await client.request('data/import',{backup})).importSummary.added,1);
 const restored=await createNativeClient({store,compact:true});
 assert.equal((await restored.request('data/export')).data.sessions.length,1);
 assert.equal(JSON.parse(value).config.apiKey,'phone-secret');
});

test('multi-question writing backups allow the existing per-answer limit and reject oversized individual answers',()=>{
 const written=round('written');written.mode='写作';
 const e=written.history[0];e.task={...e.task,kind:'text',skill:'表达',options:[],answer:'',questions:[{prompt:'Describe the meal.',options:[],answer:'A meal.'},{prompt:'Describe the room.',options:[],answer:'A room.'}]};
 e.feedback={correct:true,explanation:'符合要求',suggestion:'',weakness:''};e.answer=JSON.stringify(['a'.repeat(3000),'b'.repeat(3000)]);
 const backup=exportBackup(state([written]));assert.equal(validateBackup(backup).sessions[0].history[0].answer,e.answer);
 backup.data.sessions[0].history[0].answer=JSON.stringify(['a'.repeat(4001),'b']);assert.throws(()=>validateBackup(backup),/格式无效/);
});
