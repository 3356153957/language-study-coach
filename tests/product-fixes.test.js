import {questionAnswers,updateQuestionAnswer} from '../src/answer-input.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDraftStore} from '../src/draft-store.js';
import {createEngine} from '../server/engine.js';
import {validateLearnerAnswer,validateFeedback,prompts,skills} from '../server/coach.js';
import {reviewPlan} from '../server/review-plan.js';
import {examEvidence} from '../server/profile.js';
import {learningProgress} from '../server/learning-progress.js';
import {recordsFromBackup,mergeCloudRecords} from '../server/sync-records.js';
import {renderLearningChat} from '../src/chat.js';
const task=(id,level='A2')=>({id,kind:'text',skill:'表达',level,prompt:id,options:[],answer:'I read a book.',hint:'注意时间。',reason:'练习表达',audio:'',passage:''});
const feedback=(correct,weakness='一般过去时')=>({correct,explanation:'依据原句判断。',suggestion:'',weakness:correct ? '':weakness});
const entry=(id,at,level='A2',correct=true)=>({id,at,task:task('task-'+id,level),answer:'I read a book.',feedback:feedback(correct),activeSeconds:20});
const group={...task('group'),questions:[{prompt:'问题一',options:[],answer:'I read a book.'},{prompt:'问题二',options:[],answer:'I ate an apple.'}]};
const config={provider:'compatible',apiKey:'test-only'};
const round=(id,history,extra={})=>({id,goal:'四级',mode:'写作',targetCount:5,startedAt:history[0].at,history,current:history.at(-1).task,feedback:history.at(-1).feedback,...extra});

test('concurrent drafts merge different fields, detect same-field conflicts and keep an accessible alternative',()=>{
  const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const a=createDraftStore(storage),b=createDraftStore(storage),draft={taskId:'same',answer:'["old",""]',coachMessage:''};
  a.write(draft);b.read('same');a.write({...draft,answer:'["new",""]'});
  assert.equal(b.write({...draft,answer:'["old","second"]'}),true);
  assert.deepEqual(JSON.parse(b.lastResult.draft.answer),['new','second']);
  a.read('same');b.read('same');a.write({...draft,answer:'["newer","second"]'});
  assert.equal(b.write({...draft,answer:'["conflicting","second"]'}),false);
  assert.equal(b.lastResult.kind,'conflict');assert.equal(b.conflicts('same')[0].answer,'["conflicting","second"]');
  assert.equal(a.read('same').answer,'["newer","second"]');
  b.write({...draft,answer:'["conflicting","second"]'},{force:true});
  assert.equal(a.read('same').answer,'["conflicting","second"]');assert.ok(b.conflicts('same').some(value=>value.answer==='["newer","second"]'));
});

test('regrading an earlier task cannot replace the newest same-skill evidence or next focus',async()=>{
  const first=entry('first','2026-11-17T10:00:00Z','A2',false),last=entry('last','2026-11-17T10:05:00Z','B1');
  const profile={level:'B1',summary:'新的总结',nextFocus:'继续长句',skills:skills.map(name=>({name,level:'B1',evidence:'最新证据'}))};
  const engine=createEngine({initialState:{version:1,config,profile,sessions:[round('active',[first,last])]},save:async()=>{},modelCall:async()=>feedback(true)});
  await engine.execute('/api/session/regrade',{sessionId:'active',taskId:first.task.id,requestId:randomUUID()});
  const result=engine.profile().profile;assert.match(result.skills.find(s=>s.name==='表达').evidence,/B1/);assert.equal(result.nextFocus,'继续长句');assert.equal(result.summary,'新的总结');
});

test('skipped items are explicit, portable and excluded from independent evidence while other items are graded',async()=>{
  const answer='["I read a book.",""]';
  assert.throws(()=>validateLearnerAnswer(group,answer));validateLearnerAnswer(group,answer,{skippedQuestions:[1]});
  for(const indices of [[-1],[2],[1,1],['1']])assert.throws(()=>validateLearnerAnswer(group,answer,{skippedQuestions:indices}));
  assert.throws(()=>validateLearnerAnswer(group,'["one","nonempty"]',{skippedQuestions:[1]}));
  const result={...feedback(false,'不定冠词'),questions:[feedback(true),feedback(false,'不定冠词')]};
  assert.throws(()=>validateFeedback({...result,correct:true,questions:[feedback(true),feedback(true)]},group,answer,{skippedQuestions:[1]}));
  let context;
  const initial={version:1,config,sessions:[{id:'active',goal:'四级',mode:'写作',targetCount:5,startedAt:'2026-11-17T10:00:00Z',history:[],current:group}]};
  const engine=createEngine({initialState:initial,save:async()=>{},modelCall:async(c,p,ctx)=>{context=ctx;return {feedback:result,nextTask:task('next')};}});
  await engine.execute('/api/session/answer',{sessionId:'active',taskId:group.id,answer,skippedQuestions:[1],activeSeconds:40});
  assert.deepEqual(context.telemetry.skippedQuestions,[1]);assert.equal(engine.view({compact:true}).totals.all.count,2);assert.equal(engine.profile().examOutlook.四级.count,1);
  await engine.execute('/api/session/finish',{sessionId:'active'});
  const backup=engine.backup();assert.deepEqual(backup.data.sessions[0].history[0].skippedQuestions,[1]);
  const restored=mergeCloudRecords({version:1,sessions:[]},recordsFromBackup(backup));assert.deepEqual(restored.sessions[0].history[0].skippedQuestions,[1]);
});

test('different subquestion weaknesses have independent schedules and targeted practice only advances the chosen topic',async()=>{
  const wrong={...entry('wrong','2026-11-01T10:00:00Z'),task:group,answer:'["a","b"]',feedback:{...feedback(false,'语法'),questions:[feedback(false,'一般过去时'),feedback(false,'不定冠词')]}};
  const old=round('old',[wrong],{finishedAt:'2026-11-01T10:01:00Z',current:null});
  let state={version:1,config,sessions:[old]};
  let plans=reviewPlan(state,'UTC',new Date('2026-11-03T12:00:00Z'));assert.equal(plans.length,2);assert.deepEqual(plans.map(p=>p.reviewQuestionIndex).sort(),[0,1]);
  const follow={...entry('follow','2026-11-02T10:00:00Z'),reviewOf:wrong.id,reviewQuestionIndex:1};
  state.sessions.push(round('follow',[follow],{finishedAt:follow.at,current:null}));
  plans=reviewPlan(state,'UTC',new Date('2026-11-03T12:00:00Z'));assert.equal(plans.find(p=>p.weakness==='不定冠词').streak,1);assert.equal(plans.find(p=>p.weakness==='一般过去时').streak,0);
  const engine=createEngine({initialState:state,save:async()=>{},modelCall:async(c,p,ctx)=>{assert.equal(ctx.review.targetQuestion.prompt,'问题二');assert.equal(ctx.review.targetFeedback.weakness,'不定冠词');return {...task('targeted'),examPart:'写作'};}});
  await engine.execute('/api/session/start',{goal:'四级',mode:'写作',reviewId:wrong.id,reviewQuestionIndex:1});
  assert.equal(engine.backup().data.sessions.at(-1).reviewQuestionIndex,1);
});

test('exam evidence counts independently graded subquestions using the same unit as the dashboard',()=>{
  const four={...entry('four','2026-11-17T10:00:00Z'),task:{...group,questions:[...group.questions,...group.questions]},answer:'["a","b","c","d"]',feedback:{...feedback(true),questions:Array.from({length:4},()=>feedback(true))}};
  assert.equal(examEvidence({sessions:[round('four',[four])]},'四级').count,4);
});

test('a change to the profile level keeps the earlier comparable difficulty available',()=>{
  const history=[5,12].flatMap(day=>Array.from({length:5},(_,i)=>entry(`${day}-${i}`,`2026-11-${String(day).padStart(2,'0')}T10:00:00Z`)));
  const progress=learningProgress({sessions:[round('periods',history)]},{skills:[{name:'表达',level:'B1'}]},'UTC',new Date('2026-11-17T12:00:00Z'));
  const old=progress.otherComparisons.find(row=>row.name==='表达' && row.level==='A2');assert.equal(old.ready,true);assert.equal(old.previous.count,5);assert.equal(old.recent.count,5);
});

test('live grouped feedback exposes corrections and each revision, with a visible limit and controls for skipping and dictation',()=>{
  const record={...entry('render','2026-11-17T10:00:00Z'),task:group,answer:'["one","two"]',feedback:{...feedback(false),questions:[feedback(true),{...feedback(false),suggestion:'I ate an apple.'}]},revisions:[{id:'r',at:'2026-11-17T10:00:00Z',previousFeedback:{...feedback(false),explanation:'首次批改'}}]};
  const session=round('render',[record]);
  const render=(session,draft)=>renderLearningChat({session,draft,esc:String,button:(label,action,cls,attrs)=>`<button data-action="${action}" ${attrs}>${label}</button>`});
  const html=render(session,{answer:record.answer});assert.match(html,/根据第 2 项原句调整/);assert.match(html,/I ate an apple/);assert.match(html,/首次批改/);assert.match(html,/复核后/);assert.match(html,/1\/3/);
  const input=render({...session,history:[],feedback:null},{answer:'["one",""]',skippedQuestions:[1]});assert.match(input,/data-action="skip-question"/);assert.match(input,/data-action="voice" data-question-index="1"/);assert.match(input,/第 1 \/ 5 组/);assert.match(input,/暂停计时/);
});

test('single unanswered tasks can be explicitly skipped without entering fake answer text',()=>{
  const single=task('single');validateLearnerAnswer(single,'',{skippedQuestions:[0]});
  assert.throws(()=>validateLearnerAnswer(single,''));
  assert.throws(()=>validateFeedback(feedback(true),single,'',{skippedQuestions:[0]}));
  const chosen={...single,kind:'choice',options:['a','b'],answer:'a'};
  validateLearnerAnswer(chosen,'',{skippedQuestions:[0]});
  assert.equal(validateFeedback(feedback(false),chosen,'',{skippedQuestions:[0]}).correct,false);
});

test('a portable active review retains the exact target subquestion in tutor context after restart',async()=>{
  const wrong={...entry('portable','2026-11-01T10:00:00Z'),task:group,answer:'["a","b"]',feedback:{...feedback(false,'语法'),questions:[feedback(false,'一般过去时'),feedback(false,'不定冠词')]}};
  const initial={version:1,config,sessions:[round('old-portable',[wrong],{finishedAt:'2026-11-01T10:01:00Z',current:null})]};
  const engine=createEngine({initialState:initial,save:async()=>{},modelCall:async()=>({...task('practice'),examPart:'写作'})});
  const started=await engine.execute('/api/session/start',{goal:'四级',mode:'写作',reviewId:wrong.id,reviewQuestionIndex:1});
  const {validateBackup}=await import('../server/backup.js');
  const saved=validateBackup(engine.backup());saved.config=config;
  const restored=createEngine({initialState:saved,save:async()=>{},modelCall:async(c,p,ctx)=>{assert.equal(ctx.review.targetFeedback.weakness,'不定冠词');assert.equal(ctx.review.targetQuestion.prompt,'问题二');return {feedback:feedback(true),nextTask:task('later')};}});
  const session=started.sessions.at(-1);
  await restored.execute('/api/session/answer',{sessionId:session.id,taskId:session.current.id,answer:'I read a book.'});
});

test('dictation into an empty multi-answer task creates all fields and preserves other current answers',()=>{
  let answer=updateQuestionAnswer('',3,0,'First dictated answer.');
  assert.deepEqual(JSON.parse(answer),['First dictated answer.','','']);
  answer=updateQuestionAnswer(answer,3,1,'Typed while waiting.');
  answer=updateQuestionAnswer(answer,3,2,'Third dictated answer.');
  assert.deepEqual(questionAnswers(answer,3),['First dictated answer.','Typed while waiting.','Third dictated answer.']);
  assert.deepEqual(questionAnswers('malformed',3),['','','']);
  assert.equal(updateQuestionAnswer('',1,0,'Single answer.'),'Single answer.');
});
