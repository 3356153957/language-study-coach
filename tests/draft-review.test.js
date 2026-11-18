import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore} from '../src/draft-store.js';
import {renderAnswerReview} from '../src/answer-review.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('a new tab restores the exact per-task draft, including partial answers, newlines and assistance flags',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const first=createDraftStore(storage),draft={taskId:'one',answer:'["First line.\\nSecond line.",""]',hintUsed:true,transcriptViewed:true,activeSeconds:27,coachMessage:'我想表达的是…'};
  assert.equal(first.write(draft),true);
  const second=createDraftStore(storage);assert.deepEqual({...second.read('one'),savedAt:undefined},{...draft,savedAt:undefined});
  first.write({taskId:'two',answer:'New question'});second.write({...draft,answer:'Edited in the older tab'});
  assert.equal(first.read('two').answer,'New question');assert.equal(first.read('missing'),null);
  second.remove('one');assert.equal(first.read('one'),null);assert.equal(first.read('two').answer,'New question');
});

test('unavailable storage does not erase the last saved draft or throw during typing',()=>{
  let saved=JSON.stringify({taskId:'same',answer:'Last saved'});
  const store=createDraftStore({getItem:()=>saved,setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('disabled');}});
  assert.equal(store.write({taskId:'same',answer:'In memory'}),false);assert.equal(store.read('same').answer,'Last saved');
  store.remove('same');saved='invalid';assert.equal(store.read('same'),null);
});

test('multi-question reviews show each prompt, learner answer, reference and individual revision instead of a JSON blob',()=>{
  const entry={task:{questions:[{prompt:'What did you prepare?',options:[],answer:'I prepared the plates.'},{prompt:'What will you cook?',options:[],answer:'I will cook rice.'}]},answer:'["I prepared the plates.","I will cooking rice. <img>"]',feedback:{correct:false,questions:[{correct:true,explanation:'第一句准确。'},{correct:false,explanation:'will 后用动词原形。',suggestion:'I will cook rice.'}]}};
  const html=renderAnswerReview(entry,esc);
  for(const value of ['What did you prepare?','What will you cook?','I prepared the plates.','I will cook rice.','will 后用动词原形。','根据你的原句调整'])assert.ok(html.includes(value));
  assert.ok(!html.includes('["I prepared'));assert.ok(!html.includes('<img>'));assert.ok(html.includes('&lt;img&gt;'));
  const legacy=renderAnswerReview({...entry,feedback:{correct:false}},esc);assert.match(legacy,/未推算各小题对错/);assert.doesNotMatch(legacy,/class="round-result/);
});
