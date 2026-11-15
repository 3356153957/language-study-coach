import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { build } from 'esbuild';

const bundle=(await build({entryPoints:['src/ios-runtime.js'],bundle:true,write:false,format:'iife',platform:'browser',target:'safari16'})).outputFiles[0].text;
function harness() {
  const stores=new Map(),timers=new Map();let timerID=0;
  const question={kind:'text',skill:'表达',level:'A2',prompt:'Tell me about dinner.',passage:'',audio:'',options:[],answer:'I prepared the plates.',hint:'想想准备工作。',reason:'Native fixture.',questions:[{prompt:'What did you prepare?',options:[],answer:'I prepared the plates.'},{prompt:'What will you cook?',options:[],answer:'I will cook rice.'}]};
  const context=vm.createContext({console,
    __nativeLoad:name=>stores.get(name)||'null',__nativeSave:(name,value)=>{stores.set(name,value);return '';},
    __nativeConfig:()=>JSON.stringify({url:'https://fixtureproject.supabase.co',publishableKey:'sb_publishable_fixture_public_only'}),__nativeTimeZone:()=> 'UTC',
    __nativeUUID:()=>crypto.randomUUID(),__nativeRandom:n=>JSON.stringify([...crypto.randomBytes(n)]),__nativeSHA256:json=>JSON.stringify([...crypto.createHash('sha256').update(Buffer.from(JSON.parse(json))).digest()]),
    __nativeBase64:(value,encode)=>encode?Buffer.from(value,'binary').toString('base64'):Buffer.from(value,'base64').toString('binary'),
    __nativeURL:(raw,base)=>{try{const u=new URL(raw,base||undefined);return JSON.stringify(Object.fromEntries(['href','origin','protocol','hostname','port','username','password','pathname','search','hash'].map(k=>[k,u[k]])));}catch{return '{"error":true}';}},
    __nativeTimer:(callback,ms)=>{const id=++timerID,timer=setTimeout(()=>{timers.delete(id);callback();},ms);timer.unref();timers.set(id,timer);return id;},__nativeClearTimer:id=>{clearTimeout(timers.get(id));timers.delete(id);},
    __nativeInvoke:(id,action,json)=>queueMicrotask(()=>{
      try {
        assert.equal(action,'http');const input=JSON.parse(json);let body={},status=200;
        if(input.url.includes('/auth/v1/verify')){const token=JSON.parse(input.body).token;if(token!=='123456')status=400;else body={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user',email:'qa@example.com'}};}
        else if(input.url.endsWith('/chat/completions')){const request=JSON.parse(input.body),system=request.messages[0].content;body={choices:[{message:{content:JSON.stringify(system.includes('本次同时准备下一题')?{feedback:{correct:true,explanation:'准确。',suggestion:'I prepared the plates.',weakness:''},nextTask:{...question,prompt:'What will you do after dinner?'}}:question)}}]};}
        context.nativeDeliver(id,JSON.stringify({status,body:JSON.stringify(body),headers:{}}),'');
      } catch(e) { context.nativeDeliver(id,'null',e.message); }
    })
  });
  vm.runInContext(bundle,context);
  return {request:context.studyRequest,stores,close(){for(const timer of timers.values())clearTimeout(timer);}};
}
test('SwiftUI headless engine runs without DOM, preserves multi-answer grading and prepared tasks',async()=>{
  const h=harness();try{
    await h.request('settings',{provider:'compatible',baseURL:'https://fixture.invalid/v1',apiKey:'private-key',model:'fixture'});
    let state=await h.request('session/start',{goal:'四级',mode:'写作'}),session=state.sessions[0];
    assert.equal(session.current.questions.length,2);assert.equal(session.current.questions[0].answer,undefined);
    state=await h.request('session/answer',{sessionId:session.id,taskId:session.current.id,answer:'["I prepared the plates.","I will cook rice."]'});
    assert.equal(state.sessions[0].history.length,1);assert.equal(state.sessions[0].nextReady,true);
    const backup=await h.request('data/export');assert.equal(JSON.stringify(backup).includes('private-key'),false);
    assert.equal(JSON.parse(h.stores.get('learning-state')).sessions[0].history.length,1);
  }finally{h.close();}
});
test('SwiftUI OTP bridge returns wrong-code errors, retains logout and accepts a corrected code',async()=>{
  const h=harness();try{
    await h.request('sync/send-code',{email:'qa@example.com'});
    await assert.rejects(h.request('sync/verify',{email:'qa@example.com',code:'000000'}),/验证码无效/);
    assert.equal((await h.request('sync/status')).connected,false);
    assert.equal((await h.request('sync/verify',{email:'qa@example.com',code:'123456'})).status.connected,true);
    await h.request('sync/logout');assert.equal((await h.request('sync/status')).connected,false);
  }finally{h.close();}
});
