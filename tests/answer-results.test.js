import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { answerCounts } from '../server/answer-results.js';
import { validateFeedback, prompts } from '../server/coach.js';
import { dashboardData } from '../server/dashboard.js';
import { createEngine } from '../server/engine.js';
import { exportBackup } from '../server/backup.js';

const grouped = { id: 'question', kind: 'choice', skill: '阅读', level: 'B1', prompt: 'Read and answer.', passage: 'Mia reads a book every morning.', reason: '阅读细节', audio: '', hint: '找细节。', options: [], answer: '',
  questions: Array.from({length:4},(_,i)=>({prompt:`Part ${i+1}`,options:['A','B'],answer:'A'})) };
const explanation = { correct:false, explanation:'前三题正确，第四题再巩固。', suggestion:'', weakness:'第四题' };
test('three correct subquestions out of four count as 3/4 without multiplying study time', () => {
  const answer='["A","A","A","B"]';
  const feedback=validateFeedback(explanation,grouped,answer);
  const entry={task:grouped,answer,feedback,activeSeconds:80,at:'2026-11-16T10:00:00Z'};
  assert.deepEqual(answerCounts(entry),{count:4,correct:3});
  const totals=dashboardData({sessions:[{goal:'四级',history:[entry]}]},'UTC',new Date(entry.at)).totals.all;
  assert.equal(totals.count,4);assert.equal(totals.correct,3);assert.equal(totals.seconds,80);
  const open={...grouped,kind:'text',skill:'表达',questions:grouped.questions.slice(0,2).map(q=>({...q,options:[]}))};
  const partial=validateFeedback({...explanation,questions:[{correct:true,explanation:'第一句准确。'},{correct:false,explanation:'第二句时态错误。',weakness:'过去时'}]},open,'["One","Two"]');
  assert.deepEqual(answerCounts({task:open,answer:'["One","Two"]',feedback:partial}),{count:2,correct:1});
  assert.throws(()=>validateFeedback({...explanation,correct:true,questions:partial.questions},open,'["One","Two"]'),/矛盾/);
});

test('new open groups require item results while old whole-group grades remain portable',()=>{
  const task={...grouped,kind:'text',skill:'表达',questions:grouped.questions.slice(0,2).map(q=>({...q,options:[]}))};
  const answer='["One","Two"]';
  assert.throws(()=>validateFeedback(explanation,task,answer),/分项批改/);
  const legacy=validateFeedback(explanation,task,answer,{allowLegacy:true});
  assert.deepEqual(answerCounts({task,answer,feedback:legacy}),{count:1,correct:0});
});

test('regrading uses clarification once, keeps original answers and invalidates the stale prepared task', async () => {
  const task={...grouped,kind:'text',skill:'表达',prompt:'Describe what you prepared.',options:[],answer:'I set the table.',questions:null};
  const entry={id:'entry',task,answer:'I set the table.',feedback:explanation,activeSeconds:20,at:'2026-11-16T10:00:00Z'};
  const initialState={version:1,config:{provider:'compatible',apiKey:'test-only'},profiles:{},sessions:[{id:'active',goal:'四级',mode:'写作',targetCount:5,startedAt:entry.at,history:[entry],current:task,feedback:explanation,prepared:{task},discussions:{question:[{id:randomUUID(),message:'我说的是摆餐桌。',reply:'已理解。',at:entry.at}]}}]};
  let calls=0;
  const engine=createEngine({initialState,save:async()=>{},modelCall:async(config,prompt,context)=>{
    calls++;assert.equal(prompt,prompts.grade);assert.equal(context.discussion[0].message,'我说的是摆餐桌。');assert.equal('answer' in context.task,false);
    return {correct:true,explanation:'结合原句和澄清，表达正确。',suggestion:'',weakness:''};
  }});
  const input={sessionId:'active',taskId:task.id,requestId:randomUUID()};
  const result=await engine.execute('/api/session/regrade',input);
  const session=result.sessions[0];
  assert.equal(session.history.length,1);assert.equal(session.history[0].answer,entry.answer);assert.equal(session.history[0].activeSeconds,20);
  assert.equal(session.feedback.correct,true);assert.equal(session.nextReady,false);assert.equal(session.history[0].revisions.length,1);
  await engine.execute('/api/session/regrade',input);assert.equal(calls,1);
  const restored=exportBackup({version:1,sessions:[{...session,prepared:null}]}).data.sessions[0];
  assert.equal(restored.history[0].revisions[0].previousFeedback.correct,false);
});
