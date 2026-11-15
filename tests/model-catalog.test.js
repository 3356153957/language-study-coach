import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listModels } from '../server/model-catalog.js';
import { providers, validateAPIConnection } from '../server/providers.js';
import { createEngine } from '../server/engine.js';
import { createAPI } from '../server/api.js';
import { createNativeClient, nativeFetcher } from '../src/native-client.js';
import { renderModelOptions } from '../src/settings-panels.js';

const source = {provider:'compatible',baseURL:'https://catalog.example/v1',apiKey:'fixture-catalog-key'};

test('all API providers list models with their own authentication and never return upstream private metadata', async () => {
  for (const provider of ['openai','deepseek','compatible','anthropic','gemini']) {
    const cfg = {...source,provider,baseURL:providers[provider].baseURL || source.baseURL};
    const output = await listModels(cfg, async (address, options) => {
      const url = new URL(address);
      assert.equal(url.origin,new URL(cfg.baseURL).origin);
      assert.equal(url.pathname,`${new URL(cfg.baseURL).pathname}/models`);
      assert.equal(url.searchParams.has('key'),false);
      assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
      assert.equal(options.headers[provider==='anthropic'?'x-api-key':provider==='gemini'?'x-goog-api-key':'Authorization'],provider==='anthropic'||provider==='gemini'?cfg.apiKey:`Bearer ${cfg.apiKey}`);
      if(provider==='anthropic') assert.equal(options.headers['anthropic-version'],'2023-06-01');
      return Response.json(provider==='gemini'?{models:[{name:'models/catalog-text',displayName:'Text',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']},{name:123,supportedGenerationMethods:['generateContent']}]}:
        {data:[{id:'catalog-text',name:'Text',display_name:'Text',apiKey:cfg.apiKey},{id:'catalog-text',name:'Text'},null,{id:'bad\nid'},{id:'image-only',output_modalities:['image']}]});
    });
    assert.deepEqual(output,{models:[{id:'catalog-text',name:'Text'}],truncated:false});
    assert.equal(JSON.stringify(output).includes(cfg.apiKey),false);
  }
});

test('Anthropic and Gemini follow bounded cursor pages on the original destination, ignoring next URLs',async()=>{
  for(const provider of ['anthropic','gemini']) {
    const requests=[];
    const result=await listModels({...source,provider},async(url)=>{
      requests.push(new URL(url));
      const n=requests.length;
      return Response.json(provider==='gemini'?{models:[{name:`models/m${n}`,supportedGenerationMethods:['generateContent']}],...(n===1?{nextPageToken:'page /? token'}:{})}:
        {data:[{id:`m${n}`}],has_more:n===1,last_id:n===1?'page /? token':null,next:'https://untrusted.example/steal'});
    });
    assert.deepEqual(result.models.map(m=>m.id),['m1','m2']);
    assert.equal(requests[1].searchParams.get(provider==='gemini'?'pageToken':'after_id'),'page /? token');
    assert.ok(requests.every(u=>u.origin==='https://catalog.example'));
  }
  await assert.rejects(listModels(source,async()=>Response.json({data:[],has_more:true,last_id:'repeated'})),/分页响应异常/);
  await assert.rejects(listModels(source,async()=>Response.json({data:[],has_more:true})),/分页响应异常/);
});

test('large catalogs are capped with an explicit partial-list flag',async()=>{
  let pages=0;
  const result=await listModels(source,async()=>{const page=++pages;return Response.json({data:Array.from({length:1000},(_,i)=>({id:`page-${page}-model-${i}`})),has_more:true,last_id:`page-${page}`});});
  assert.equal(result.models.length,2000);assert.equal(result.truncated,true);assert.equal(pages,3);
});

test('catalog failures offer manual entry without leaking response bodies, credentials or raw network errors',async()=>{
  for(const status of [401,403,404,405,429,500]) {
    await assert.rejects(listModels(source,async()=>new Response(source.apiKey,{status})),e=>!e.message.includes(source.apiKey)&&e.status===502);
  }
  await assert.rejects(listModels(source,async()=>{throw new Error(`Secret ${source.apiKey}`);}),/检查接口地址和网络/);
  await assert.rejects(listModels(source,async()=>{throw new DOMException('hidden detail','TimeoutError');}),/超时/);
  await assert.rejects(listModels(source,async()=>Response.json({unexpected:[]})),/格式无法识别/);
  assert.deepEqual(await listModels(source,async()=>Response.json({data:[]})),{models:[],truncated:false});
});

test('discovery needs no model ID, never saves configuration, and only reuses keys for the exact saved provider and address',async()=>{
  let saves=0,calls=0;
  const cfg={...source,model:'keep-this-selection'};
  const engine=createEngine({initialState:{version:1,config:cfg,sessions:[],profiles:{}},save:async()=>{saves++;},modelFetcher:async(_,o)=>{calls++;assert.equal(o.headers.Authorization,`Bearer ${source.apiKey}`);return Response.json({data:[{id:'choose-yourself'}]});}});
  assert.deepEqual((await engine.models({...source,model:'',apiKey:''})).models,[{id:'choose-yourself',name:'choose-yourself'}]);
  assert.equal(engine.view().config.model,'keep-this-selection');assert.equal(saves,0);
  await assert.rejects(engine.models({...source,apiKey:'',baseURL:'https://different.example/v1'}),/重新填写/);
  await assert.rejects(engine.models({...source,apiKey:'',provider:'openai'}),/重新填写/);
  await assert.rejects(engine.models({...source,provider:'codex'}),/API 服务商/);
  assert.equal(calls,1);
  assert.throws(()=>validateAPIConnection({...source,baseURL:'https://catalog.example/v1?key=secret'}),/不能带/);
});

test('native discovery makes a body-free GET with bounded timeouts and keeps encrypted saved credentials off the UI response',async()=>{
  let captured,saves=0;
  const cfg={...source,model:'saved-model'};
  const client=await createNativeClient({store:{load:async()=>({value:JSON.stringify({version:1,config:cfg,profiles:{},sessions:[]})}),save:async()=>{saves++;}},
    modelFetcher:nativeFetcher({request:async options=>{captured=options;return {status:200,data:{data:[{id:'upstream-model'}]}};}})});
  try {
    const result=await client.request('settings/models',{...source,apiKey:''});
    assert.equal(captured.method,'GET');assert.equal('data' in captured,false);assert.equal(captured.disableRedirects,true);assert.equal(captured.readTimeout,15000);
    assert.equal(result.models[0].id,'upstream-model');assert.equal(JSON.stringify(result).includes(source.apiKey),false);assert.equal(saves,0);
    await assert.rejects(client.request('settings/models',{...source,baseURL:'http://127.0.0.1:5000/v1'}),/须使用 HTTPS/);
  } finally {client.close();}
});

test('slow model discovery does not block saving and its HTTP endpoint rejects cross-site calls',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'lsc-model-catalog-test-'));
  let started,release;
  const waiting=new Promise(resolve=>{started=resolve;});
  const api=await createAPI({directory,codex:{close(){}},modelFetcher:async()=>{started();await new Promise(resolve=>{release=resolve;});return Response.json({data:[{id:'listed-model',secret:source.apiKey}]});}});
  const server=createServer(api);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{api.close();await new Promise(resolve=>server.close(resolve));assert.ok(path.basename(directory).startsWith('lsc-model-catalog-test-'));await rm(directory,{recursive:true,force:true});});
  const call=(route,body,extra={})=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:`/api/${route}`,method:'POST',headers:{'Content-Type':'application/json','X-Coach-Request':'1',...extra},agent:false},res=>{let data='';res.on('data',x=>{data+=x;});res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}));});req.on('error',reject);req.end(JSON.stringify(body));
  });
  assert.equal((await call('settings/models',source,{Origin:'https://untrusted.example'})).status,403);
  const pending=call('settings/models',source);await waiting;
  try {assert.equal((await call('settings',{...source,model:'my-choice'})).status,200);} finally {release();}
  const result=await pending;assert.equal(result.status,200);assert.deepEqual(result.data.models,[{id:'listed-model',name:'listed-model'}]);
});

test('model selection preserves the user choice during search and escapes untrusted names without auto-selecting the first result',()=>{
  const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const models=[{id:'a',name:'First'},{id:'b',name:'<script>untrusted</script>'}];
  assert.doesNotMatch(renderModelOptions({models,query:'',current:'',esc}),/ selected/);
  assert.match(renderModelOptions({models,query:'missing',current:'b',esc}),/selected value="b"/);
  assert.match(renderModelOptions({models,query:'',current:'custom-alias',esc}),/selected value="custom-alias"/);
  assert.doesNotMatch(renderModelOptions({models,query:'',current:'b',esc}),/<script>/);
});
