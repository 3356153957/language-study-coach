import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { exportBackup } from '../server/backup.js';
import { predictionFixture } from './fixtures/exam-fixture.js';

const bundle=(await build({entryPoints:['src/ios-runtime.js'],bundle:true,write:false,format:'iife',platform:'browser',target:'safari16'})).outputFiles[0].text;

test('SwiftUI restores the archived CET prediction after backup import and process restart without any model request',async()=>{
  const h=harness();let restarted;
  try{
    const backup=exportBackup(predictionFixture());
    await h.request('data/import',{backup});
    restarted=harness({stores:h.stores});
    for(const device of [h,restarted]){
      assert.equal(device.startupError,undefined);
      const outlook=(await device.request('state')).examOutlook;
      assert.equal(outlook['四级'].estimate?.high,60);
      assert.equal(outlook['四级'].estimate.updatedAt,'2026-11-14T10:00:00.000Z');
      assert.equal(outlook['六级'].estimate,null);
      assert.equal(device.calls.length,0);
    }
  }finally{h.close();restarted?.close();}
});
function harness({stores=new Map(),http,native}={}) {
  const timers=new Map(),cancelled=[],calls=[];let timerID=0,failWrites=false;
  const question={kind:'text',skill:'表达',level:'A2',prompt:'Tell me about dinner.',passage:'',audio:'',options:[],answer:'I prepared the plates.',hint:'想想准备工作。',reason:'Native fixture.',questions:[{prompt:'What did you prepare?',options:[],answer:'I prepared the plates.'},{prompt:'What will you cook?',options:[],answer:'I will cook rice.'}]};
  const context=vm.createContext({console,
    __nativeLoad:name=>stores.get(name)??'null',__nativeSave:(name,value)=>{if(failWrites)return '保存失败，原记录未覆盖，请检查手机存储空间。';stores.set(name,value);return '';},
    __nativeConfig:()=>JSON.stringify({url:'https://fixtureproject.supabase.co',publishableKey:'sb_publishable_fixture_public_only'}),__nativeTimeZone:()=> 'UTC',
    __nativeUUID:()=>crypto.randomUUID(),__nativeRandom:n=>JSON.stringify([...crypto.randomBytes(n)]),__nativeSHA256:json=>JSON.stringify([...crypto.createHash('sha256').update(Buffer.from(JSON.parse(json))).digest()]),
    __nativeBase64:(value,encode)=>encode?Buffer.from(value,'binary').toString('base64'):Buffer.from(value,'base64').toString('binary'),
    __nativeURL:(raw,base)=>{try{const u=new URL(raw,base||undefined);return JSON.stringify(Object.fromEntries(['href','origin','protocol','hostname','port','username','password','pathname','search','hash'].map(k=>[k,u[k]])));}catch{return '{"error":true}';}},
    __nativeTimer:(callback,ms)=>{const id=++timerID,timer=setTimeout(()=>{timers.delete(id);callback();},ms);timer.unref();timers.set(id,timer);return id;},__nativeClearTimer:id=>{clearTimeout(timers.get(id));timers.delete(id);},
    __nativeCancel:id=>cancelled.push(id),
    __nativeInvoke:(id,action,json)=>queueMicrotask(async()=>{
      try {
        const input=JSON.parse(json);calls.push({action,input});
        if(action!=='http'){assert.ok(native,`Unexpected host action: ${action}`);const value=await native(action,input);context.nativeDeliver(id,JSON.stringify(value),'');return;}
        if(http){const value=await http(input);if(value){context.nativeDeliver(id,JSON.stringify(value),'');return;}}
        let body={},status=200;
        if(input.url.includes('/auth/v1/verify')){const token=JSON.parse(input.body).token;if(token!=='123456')status=400;else body={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user',email:'qa@example.com'}};}
        else if(input.url.endsWith('/chat/completions')){const request=JSON.parse(input.body),system=request.messages[0].content;body={choices:[{message:{content:JSON.stringify(system.includes('本次同时准备下一题')?{feedback:{correct:true,explanation:'准确。',suggestion:'I prepared the plates.',weakness:'',questions:question.questions.map(()=>({correct:true,explanation:'准确。',suggestion:'',weakness:''}))},nextTask:{...question,prompt:'What will you do after dinner?'}}:question)}}]};}
        context.nativeDeliver(id,JSON.stringify({status,body:JSON.stringify(body),headers:{}}),'');
      } catch(e) { context.nativeDeliver(id,'null',e.message); }
    })
  });
  let startupError;try{vm.runInContext(bundle,context);}catch(error){startupError=error;}
  return {request:context.studyRequest,context,stores,calls,cancelled,timers,startupError,set failWrites(value){failWrites=value;},close(){for(const timer of timers.values())clearTimeout(timer);}};
}
test('SwiftUI can chat before opening a round and reload the conversation after restart', async () => {
  const h = harness({ http: async input => {
    if (!input.url.endsWith('/chat/completions')) return null;
    return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{"reply":"可以，今天就聊聊。"}' } }] }) };
  } });
  let restarted;
  try {
    await h.request('settings', { provider: 'compatible', baseURL: 'https://fixture.invalid/v1', apiKey: 'test-only', model: 'fixture' });
    const before = await h.request('coach/chat', {});
    assert.equal(before.turns.length, 0);
    const requestId = crypto.randomUUID();
    await assert.rejects(h.request('coach/chat', { requestId, message: '' }), /请输入/);
    await h.request('coach/chat', { requestId, message: '今天想和教练聊聊。' });
    restarted = harness({ stores: h.stores });
    assert.equal((await restarted.request('coach/chat', {})).turns[0].reply, '可以，今天就聊聊。');
    assert.equal((await restarted.request('state')).sessions.length, 0);
  } finally {
    h.close();
    restarted?.close();
  }
});

test('SwiftUI wordbook and manual assessment survive restart through the native bridge',async()=>{
  const h=harness({http:async input=>input.url.endsWith('/chat/completions') ? {status:200,headers:{},body:JSON.stringify({choices:[{message:{content:JSON.stringify({probability:12.23,reason:'原生引擎验收，样本存在局限。'})}}]})} : null});
  let restarted;
  try{
    await h.request('data/import',{backup:exportBackup(predictionFixture())});
    await h.request('settings',{provider:'compatible',baseURL:'https://fixture.invalid/v1',apiKey:'test-only',model:'fixture'});
    let state=await h.request('vocabulary/mark',{sessionId:'round-0',taskId:'task-entry-0-0',word:'plates',status:'learning'});
    assert.equal(state.wordbook[0].word,'plates');
    state=await h.request('exam/assess',{goal:'四级',requestId:crypto.randomUUID()});
    assert.equal(state.examOutlook['四级'].estimate.probabilityText,'12.23%');
    restarted=harness({stores:h.stores});
    const restored=await restarted.request('state');
    assert.equal(restored.wordbook[0].word,'plates');assert.equal(restored.examOutlook['四级'].estimate.probabilityText,'12.23%');
  }finally{h.close();restarted?.close();}
});

test('SwiftUI headless engine runs without DOM, preserves multi-answer grading and prepared tasks',async()=>{
  const h=harness();try{
    await h.request('settings',{provider:'compatible',baseURL:'https://fixture.invalid/v1',apiKey:'private-key',model:'fixture'});
    let state=await h.request('session/start',{goal:'高中英语',mode:'写作'}),session=state.sessions[0];
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

test('SwiftUI offline OTP attempts keep the code retryable without consuming wrong-code attempts',async()=>{
  const h=harness({http:async()=>{throw new Error('offline');}});try{
    for(let i=0;i<9;i++)await assert.rejects(h.request('sync/verify',{email:'qa@example.com',code:'123456'}),/网络/);
    const saved=JSON.parse(h.stores.get('cloud-sync')||'null');
    assert.equal(Object.values(saved?.otp.emails||{}).some(guard=>guard.failedCount>0),false);
    assert.equal((await h.request('sync/status')).connected,false);
  }finally{h.close();}
});

test('SwiftUI rejects unreadable saved learning state before accepting any writes',()=>{
  for(const raw of ['{broken','false','[]','{"version":2,"sessions":[]}','{"version":1,"sessions":[{}]}']){
    const stores=new Map([['learning-state',raw]]),h=harness({stores});try{
      assert.match(h.startupError?.message||'',/记录.*读取/);
      assert.equal(stores.get('learning-state'),raw);assert.equal(stores.size,1);
    }finally{h.close();}
  }
});

test('SwiftUI rejects failed answer writes, keeps the original question and supports retry and restart',async()=>{
  const h=harness();let restored;try{
    await h.request('settings',{provider:'compatible',baseURL:'https://fixture.invalid/v1',apiKey:'private-key',model:'fixture'});
    const started=await h.request('session/start',{goal:'高中英语',mode:'写作'}),session=started.sessions[0];
    const input={sessionId:session.id,taskId:session.current.id,answer:'["I prepared the plates.","I will cook rice."]'};
    const original=h.stores.get('learning-state');h.failWrites=true;
    await assert.rejects(h.request('session/answer',input),/保存失败/);
    assert.equal(h.stores.get('learning-state'),original);
    assert.equal((await h.request('state')).sessions[0].history.length,0);
    h.failWrites=false;await h.request('session/answer',input);
    restored=harness({stores:h.stores});assert.equal(restored.startupError,undefined);
    const resumed=(await restored.request('state')).sessions[0];assert.equal(resumed.history.length,1);assert.equal(resumed.nextReady,true);
    await restored.request('session/next',{sessionId:session.id,taskId:session.current.id});
    assert.equal(restored.calls.filter(call=>call.action==='http').length,0);
  }finally{h.close();restored?.close();}
});

test('SwiftUI completed HTTP requests release deadline timers and cancelled requests cancel the host task',async()=>{
  let deliver;const h=harness({http:()=>new Promise(resolve=>{deliver=resolve;})});try{
    const controller=new h.context.AbortController();
    const pending=h.context.fetch('https://fixture.invalid',{signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));controller.abort();
    await assert.rejects(pending,{name:'AbortError'});assert.equal(h.cancelled.length,1);
    deliver({status:200,body:'{}',headers:{}});await new Promise(resolve=>setImmediate(resolve));
    const timedOut=assert.rejects(h.context.fetch('https://fixture.invalid',{signal:h.context.AbortSignal.timeout(5)}),{name:'TimeoutError'});
    await Promise.all([timedOut,new Promise(resolve=>setTimeout(resolve,15))]);assert.equal(h.cancelled.length,2);
    deliver({status:200,body:'{}',headers:{}});await new Promise(resolve=>setImmediate(resolve));
    for(let i=0;i<10;i++){
      const done=h.context.fetch('https://fixture.invalid',{signal:h.context.AbortSignal.timeout(60000)});
      await new Promise(resolve=>setImmediate(resolve));deliver({status:200,body:'{}',headers:{}});await done;
    }
    assert.equal(h.timers.size,0);
  }finally{h.close();}
});

test('iOS packaging rejects a server secret before modifying bundled public configuration',async()=>{
  const file='ios/App/App/NativeResources/public-config.json';
  const before=await readFile(file).catch(()=>null);
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-native-ios.mjs'],{
    env:{...process.env,VITE_SUPABASE_URL:'https://fixtureproject.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_must_never_be_bundled'},stdio:'pipe'
  }),error=>error.status!==0 && /Publishable Key/.test(String(error.stderr)));
  assert.deepEqual(await readFile(file).catch(()=>null),before);
});

test('SwiftUI reuses a paginated request deadline without leaving idle timers',async()=>{
  const h=harness();try{
    const signal=h.context.AbortSignal.timeout(20);
    await h.context.fetch('https://fixture.invalid',{signal});assert.equal(h.timers.size,0);
    await new Promise(resolve=>setTimeout(resolve,30));
    await assert.rejects(h.context.fetch('https://fixture.invalid',{signal}),{name:'TimeoutError'});
    assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
    const url=new h.context.URL('https://fixture.invalid/proxy%2Fv1/models?page=1#model');
    url.searchParams.set('page','2');assert.equal(url.href,'https://fixture.invalid/proxy%2Fv1/models?page=2#model');
    const value='中文🙂\ud800';assert.deepEqual([...new h.context.TextEncoder().encode(value)],[...new TextEncoder().encode(value)]);
    const integers=vm.runInContext('new Int32Array(4)',h.context);assert.equal(h.context.crypto.getRandomValues(integers),integers);
    h.context.__nativeRandom=()=> 'null';assert.throws(()=>h.context.crypto.getRandomValues(integers),/无法安全生成/);
  }finally{h.close();}
});

test('SwiftUI ChatGPT authorization verifies PKCE and identity before model access and always closes the auth surface',async()=>{
  let authorizeURL,closes=0,mode='cancel',verifications=0;
  const h=harness({
    native:async(action,input)=>{
      if(action==='prepareAuth')return {redirectURI:'http://127.0.0.1:1455/auth/callback'};
      if(action==='cancelAuth'){closes++;return null;}
      if(action==='openAuth'){
        authorizeURL=new URL(input.url);
        if(mode==='cancel')throw new Error('已取消 ChatGPT 授权。');
        const callback=new URL(authorizeURL.searchParams.get('redirect_uri'));
        callback.searchParams.set('state',mode==='bad-state'?'bad-state':authorizeURL.searchParams.get('state'));
        callback.searchParams.set('code','fixture-code');callback.searchParams.set('client_id','fixture-client');
        return {callbackURL:callback.href};
      }
      if(action==='verifyIdentity'){
        verifications++;assert.equal(input.nonce,authorizeURL.searchParams.get('nonce'));
        assert.equal(input.clientId,'fixture-client');assert.equal(input.token,'signed-token-fixture');
        if(mode==='bad-identity')throw new Error('ChatGPT 身份校验失败，本次授权未保存。');
        return {subject:'fixture-subject',email:'qa@example.com'};
      }
      throw new Error(`Unknown native action: ${action}`);
    },
    http:async input=>{
      let body;
      if(input.url.endsWith('/oauth/token')){
        const form=new URLSearchParams(input.body);
        assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorizeURL.searchParams.get('code_challenge'));
        body={access_token:'private-access-token',refresh_token:'private-refresh-token',id_token:'signed-token-fixture',token_type:'bearer',expires_in:3600,scope:'openid chatgpt.tokens.use.direct'};
      }else if(input.url.endsWith('/models'))body={models:[{slug:'fixture-model',visibility:'list',display_name:'Fixture'}]};
      else if(input.url.endsWith('/responses')){
        assert.equal(input.headers.authorization,'Bearer private-access-token');
        return {status:200,headers:{},body:'data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"ok":true}'})+'\n\ndata: {"type":"response.completed"}\n\n'};
      }
      if(body)return {status:200,headers:{},body:JSON.stringify(body)};
    }
  });try{
    await assert.rejects(h.request('chatgpt/login'),/已取消/);assert.equal(closes,1);
    mode='bad-state';await assert.rejects(h.request('chatgpt/login'),/回调校验失败/);assert.equal(closes,2);assert.equal(verifications,0);
    mode='bad-identity';await assert.rejects(h.request('chatgpt/login'),/身份校验失败/);assert.equal(closes,3);assert.equal((await h.request('chatgpt/status')).loggedIn,false);
    mode='success';assert.equal((await h.request('chatgpt/login')).loggedIn,true);assert.equal(closes,4);
    assert.equal((await h.request('chatgpt/models')).models[0].id,'fixture-model');
    await h.request('settings',{provider:'chatgpt',model:'fixture-model'});await h.request('settings/test');
    const publicData=JSON.stringify({state:await h.request('state'),auth:await h.request('chatgpt/status'),backup:await h.request('data/export')});
    for(const secret of ['private-access-token','private-refresh-token','signed-token-fixture'])assert.equal(publicData.includes(secret),false);
    assert.equal(h.timers.size,0);
  }finally{h.close();}
});
