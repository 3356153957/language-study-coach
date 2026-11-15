import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createCloudSync, validateSyncConfig } from '../server/cloud-sync.js';
import { createEngine } from '../server/engine.js';
import { exportBackup } from '../server/backup.js';
import { reconcile, recordsFromBackup } from '../server/sync-records.js';
import { nativeSyncTransport, createNativeClient } from '../src/native-client.js';
import { createAPI } from '../server/api.js';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const config={url:'https://testproject.supabase.co',publishableKey:'sb_publishable_test_only_public_key'};
const at='2026-11-15T10:00:00.000Z';
const round=(id,active=false)=>({id,goal:'四级',mode:'综合',targetCount:5,startedAt:at,finishedAt:active?null:at,current:active?{id:`current-${id}`,kind:'choice',skill:'语法',level:'A2',prompt:'I ___ a book yesterday.',options:['read','reads'],answer:'read',reason:'复习',hint:'过去式',audio:'',passage:''}:null,feedback:null,
  history:[{id:`answer-${id}`,task:{id:`task-${id}`,kind:'choice',skill:'语法',level:'A2',prompt:'I ___ a book yesterday.',options:['read','reads'],answer:'read',reason:'复习',hint:'过去式',audio:'',passage:''},answer:'read',feedback:{correct:true,explanation:'正确',suggestion:'',weakness:''},at,askedAt:at,activeSeconds:20}]});

async function database() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  await db.query('insert into auth.users values($1),($2)',[A,B]);
  const migration=await readFile(new URL('../supabase/migrations/202611150001_learning_sync.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  let queue=Promise.resolve();
  const as=(uid,fn,role='authenticated')=>{
    const run=queue.then(async()=>{
      await db.exec(`begin;set local role ${role};`);
      try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid || '']);const result=await fn(db);await db.exec('commit');return result;}
      catch(e){await db.exec('rollback');throw e;}
    });queue=run.catch(()=>{});return run;
  };
  return {db,as};
}
const apply=(db,kind,id,payload,revision=0)=>db.query('select public.lsc_sync_apply($1,$2,$3::jsonb,$4) as result',[kind,id,JSON.stringify(payload),revision]).then(r=>r.rows[0].result);

test('platform automatic-RLS helper keeps its owner privileges but cannot be executed by clients',async()=>{
  const db=new PGlite();
  try {
    const migration=await readFile(new URL('../supabase/migrations/20261115161216_harden_default_rls.sql',import.meta.url),'utf8');
    await db.exec('create role anon; create role authenticated;');
    // Projects without the optional Supabase helper remain supported.
    await db.exec(migration);
    await db.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin return; end; $$;`);
    await db.exec(migration); await db.exec(migration);
    const {rows}=await db.query(`select has_function_privilege('anon','public.rls_auto_enable()','execute') as anon,
      has_function_privilege('authenticated','public.rls_auto_enable()','execute') as member,
      has_function_privilege(current_user,'public.rls_auto_enable()','execute') as owner;`);
    assert.deepEqual(rows,[{anon:false,member:false,owner:true}]);
  } finally {await db.close();}
});

test('real PostgreSQL migration enforces account isolation, authenticated CAS, payload limits and denied direct writes',async()=>{
  const {db,as}=await database();
  try {
    const first=await as(A,d=>apply(d,'round','same',{answer:'a'}));
    assert.equal(first.applied,true);assert.equal(first.record.revision,1);
    assert.equal((await as(B,d=>d.query('select * from public.lsc_sync_records'))).rows.length,0);
    const other=await as(B,d=>apply(d,'round','same',{answer:'b'}));assert.equal(other.record.revision,1);
    const stale=await as(A,d=>apply(d,'round','same',{answer:'overwrite'},0));assert.equal(stale.applied,false);assert.equal(stale.record.payload.answer,'a');
    const same=await as(A,d=>apply(d,'round','same',{answer:'a'},1));assert.equal(same.record.revision,1);
    assert.equal((await as(A,d=>apply(d,'round','new',{answer:'second'}))).record.revision,2);
    await assert.rejects(as(A,d=>d.query("update public.lsc_sync_records set payload='{}'")),/permission denied/);
    await assert.rejects(as(A,d=>d.query('delete from public.lsc_sync_records')),/permission denied/);
    await assert.rejects(as(null,d=>apply(d,'round','bad',{})),/Authentication required/);
    await assert.rejects(as(null,d=>apply(d,'round','bad',{}),'anon'),/permission denied/);
    await assert.rejects(as(A,d=>apply(d,'round','big',{text:'x'.repeat(524288)})),/Invalid sync record/);
    const rows=await as(A,d=>d.query('select payload from public.lsc_sync_records order by revision'));
    assert.deepEqual(rows.rows.map(r=>r.payload.answer),['a','second']);
  } finally {await db.close();}
});

function authFactory({uid=A,clock=()=>Date.now(),counts={}}={}) {
  const session=()=>({access_token:`test-access-${uid}`,refresh_token:'test-refresh-private',expires_at:Math.floor(clock()/1000)+3600,user:{id:uid,email:uid===A?'a@example.com':'b@example.com'}});
  return ()=>({auth:{signInWithOtp:async()=>({error:null}),verifyOtp:async()=>({data:{session:session()}}),refreshSession:async()=>{counts.refresh=(counts.refresh || 0)+1;return {data:{session:session()}};}}});
}
async function mockCloud() {
  const {db,as}=await database(),control={offline:false,uploads:[]};
  const transport=async(url,options)=>{
    if(control.offline) throw new Error('offline');
    const h=new Headers(options.headers),uid=h.get('authorization')?.slice('Bearer test-access-'.length);
    return as(uid,async d=>{
      const u=new URL(url);
      if(u.pathname.endsWith('/rpc/lsc_sync_apply')) {
        const b=JSON.parse(options.body);control.uploads.push(b);
        return Response.json(await apply(d,b.p_kind,b.p_id,b.p_payload,b.p_expected));
      }
      if(options.method==='HEAD') {const r=await d.query('select count(*) from public.lsc_sync_records');return new Response(null,{headers:{'content-range':`0-0/${r.rows[0].count}`}});}
      const revision=Number(u.searchParams.get('revision')?.slice(3) || 0);
      const r=await d.query('select kind,id,payload,revision from public.lsc_sync_records where revision>$1 order by revision limit 25',[revision]);
      return Response.json(r.rows.map(row=>({...row,revision:Number(row.revision)})));
    });
  };
  return {db,control,transport};
}
async function device(cloud,{uid=A,rounds=[],stored=null,clock=()=>Date.now(),counts={}}={}) {
  const disk={sync:stored,fail:false,learning:{version:1,sessions:rounds,config:{provider:'openai',apiKey:'never-sync-this-key'}}};
  const engine=createEngine({initialState:disk.learning,save:async s=>{if(disk.fail)throw new Error('disk full');disk.learning=structuredClone(s);}});
  const sync=createCloudSync({engine,load:async()=>disk.sync,save:async s=>{disk.sync=structuredClone(s);},transport:cloud.transport,authFactory:authFactory({uid,clock,counts}),now:clock,schedule:false});
  if(!stored){await sync.action('configure',config);await sync.action('verify',{email:uid===A?'a@example.com':'b@example.com',code:'123456'});}
  return {disk,engine,sync};
}

test('two devices merge completed rounds, retain separate active exercises, never upload credentials, and survive offline retries',async()=>{
  const cloud=await mockCloud();
  try {
    const a=await device(cloud,{rounds:[round('a'),round('phone',true)]});
    const b=await device(cloud,{rounds:[round('b'),round('computer',true)]});
    assert.equal(cloud.control.uploads.length,0);assert.equal((await a.sync.action('preview')).preview.answers,2);
    await a.sync.action('enable',{confirmed:true});
    cloud.control.offline=true;await b.sync.action('enable',{confirmed:true});assert.equal((await b.sync.status()).phase,'error');assert.equal(b.engine.backup().data.sessions.length,2);
    cloud.control.offline=false;await b.sync.action('run');await a.sync.action('run');
    assert.deepEqual(a.engine.backup().data.sessions.map(r=>r.id).sort(),['a','b','phone']);
    assert.deepEqual(b.engine.backup().data.sessions.map(r=>r.id).sort(),['a','b','computer']);
    assert.equal(JSON.stringify(cloud.control.uploads).includes('never-sync'),false);
    assert.equal(JSON.stringify(await a.sync.status()).includes('test-access'),false);
    assert.equal(JSON.stringify(await a.sync.status()).includes('test-refresh'),false);
    const before=cloud.control.uploads.length;await a.sync.action('run');assert.equal(cloud.control.uploads.length,before);
    // Once a source device finishes, the other device receives the full round.
    // Fixture uses a report-free copied finished round, avoiding real AI calls.
    const completed=round('phone');const backup=exportBackup({sessions:[completed]});
    const c=await device(cloud,{rounds:backup.data.sessions,stored:a.disk.sync});await c.sync.action('run');await b.sync.action('run');
    assert.ok(b.engine.backup().data.sessions.some(r=>r.id==='phone' && r.finishedAt));
  } finally {await cloud.db.close();}
});

test('divergent answers preserve both copies; failed local writes do not advance the cursor',async()=>{
  const cloud=await mockCloud();
  try {
    const a=await device(cloud,{rounds:[round('same')]});await a.sync.action('enable',{confirmed:true});
    const different=round('same');different.history[0].activeSeconds=30;
    const b=await device(cloud,{rounds:[different]});await b.sync.action('enable',{confirmed:true});
    assert.equal((await b.sync.status()).conflicts.length,1);assert.equal(b.engine.backup().data.sessions[0].history[0].activeSeconds,30);
    const c=await device(cloud);c.disk.fail=true;await c.sync.action('enable',{confirmed:true});assert.equal(c.disk.sync.cursor,0);
    c.disk.fail=false;await c.sync.action('run');assert.equal(c.engine.backup().data.sessions[0].history[0].activeSeconds,20);assert.ok(c.disk.sync.cursor>0);
    assert.equal(reconcile(recordsFromBackup(a.engine.backup())[0],recordsFromBackup(b.engine.backup())[0]),null);
  } finally {await cloud.db.close();}
});

test('a cloud write racing after the pull cannot silently replace a different answer',async()=>{
  const cloud=await mockCloud();
  try {
    const a=await device(cloud,{rounds:[round('race')]});
    let raced=false;
    const different=round('race');different.history[0].hintUsed=true;
    const b=await device({...cloud,transport:async(url,o)=>{
      if(!raced && o.method==='GET') {raced=true;await a.sync.action('enable',{confirmed:true});return Response.json([]);}
      return cloud.transport(url,o);
    }},{rounds:[different]});
    await b.sync.action('enable',{confirmed:true});
    assert.equal((await b.sync.status()).conflicts.length,1);
    assert.equal(b.engine.backup().data.sessions[0].history[0].hintUsed,true);
    await a.sync.action('run');assert.equal(a.engine.backup().data.sessions[0].history[0].hintUsed,false);
  } finally {await cloud.db.close();}
});

test('pause during a batch stops further uploads after the in-flight record',async()=>{
  const cloud=await mockCloud();
  try {
    let pendingPause;
    const d=await device({...cloud,transport:async(url,o)=>{
      const result=await cloud.transport(url,o);
      if(o.method==='POST' && !pendingPause) pendingPause=d.sync.action('disable');
      return result;
    }},{rounds:[round('one'),round('two'),round('three')]});
    await d.sync.action('enable',{confirmed:true});await pendingPause;
    assert.equal(cloud.control.uploads.length,1);assert.equal((await d.sync.status()).enabled,false);
    assert.equal(d.engine.backup().data.sessions.length,3);
  } finally {await cloud.db.close();}
});

test('account binding blocks another user, logout removes tokens, refresh is serialized, and unsafe endpoints/keys are rejected',async()=>{
  for(const url of ['http://testproject.supabase.co','https://127.0.0.1','https://testproject.supabase.co/a','https://x.supabase.co@evil.example/']) assert.throws(()=>validateSyncConfig({...config,url}));
  assert.throws(()=>validateSyncConfig({...config,publishableKey:'sb_secret_abcdef'}));
  assert.throws(()=>validateSyncConfig({...config,publishableKey:`e30.${btoa('{"role":"service_role"}')}.sig`}));
  const cloud=await mockCloud();
  try {
    let time=Date.now();const counts={};const a=await device(cloud,{clock:()=>time,counts});await a.sync.action('enable',{confirmed:true});
    time+=3600000;await Promise.all([a.sync.action('run'),a.sync.action('run')]);assert.equal(counts.refresh,1);
    await a.sync.action('logout');assert.equal(a.disk.sync.session,null);assert.equal((await a.sync.status()).enabled,false);
    await assert.rejects(a.sync.action('send-code',{email:'b@example.com'}),/绑定/);
    const wrong=await device(cloud,{uid:B,stored:a.disk.sync});await assert.rejects(wrong.sync.action('verify',{email:'b@example.com',code:'123456'}),/绑定/);
    await assert.rejects(a.sync.action('configure',{...config,url:'https://anotherproject.supabase.co'}),/绑定/);
  } finally {await cloud.db.close();}
});

test('native sync uses genuine Response headers for OTP/REST, encrypted store survives restart, and backups exclude sync tokens',async()=>{
  let args;const transport=nativeSyncTransport({request:async input=>{args=input;return {status:200,data:'{"ok":true}',headers:{'content-range':'0-0/4'}};}});
  const r=await transport('https://testproject.supabase.co',{method:'HEAD',headers:new Headers({apikey:'test'})});
  assert.equal(r.headers.get('content-range'),'0-0/4');assert.equal(await r.text(),'');assert.equal(args.disableRedirects,true);
  const store={value:null,sync:null,load:async()=>({value:store.value}),save:async({value})=>{store.value=value;},loadSync:async()=>({value:store.sync}),saveSync:async({value})=>{store.sync=value;}};
  const options={store,syncOptions:{schedule:false,authFactory:authFactory()}};
  const a=await createNativeClient(options);await a.request('sync/configure',config);await a.request('sync/verify',{email:'a@example.com',code:'123456'});
  const b=await createNativeClient(options);assert.equal((await b.request('sync/status')).email,'a@example.com');
  assert.equal(JSON.stringify(await b.request('data/export')).includes('test-refresh'),false);
  assert.equal((await b.request('sync/logout',{})).status.connected,false);
  a.close();b.close();
});

test('official Supabase SDK OTP and refresh contract works without browser token storage',async()=>{
  let time=Date.now(),saved;const calls=[];
  const jwt=`eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({sub:A,exp:Math.floor(time/1000)+7200}))}.test`;
  const engine=createEngine({save:async()=>{}});
  const sync=createCloudSync({engine,load:async()=>null,save:async s=>{saved=s;},schedule:false,now:()=>time,
    transport:async(url,o)=>{
      calls.push({url,body:o.body});
      assert.equal(o.redirect,'error');assert.equal(new Headers(o.headers).get('apikey'),config.publishableKey);
      if(url.includes('/auth/v1/otp'))return Response.json({});
      if(url.includes('/auth/v1/verify') || url.includes('/auth/v1/token')) return Response.json({access_token:jwt,token_type:'bearer',expires_in:3600,refresh_token:'private-rotated-refresh',user:{id:A,email:'a@example.com',aud:'authenticated',role:'authenticated'}});
      return Response.json([]);
    }});
  await sync.action('configure',config);await sync.action('send-code',{email:'a@example.com'});await sync.action('verify',{email:'a@example.com',code:'123456'});
  assert.equal((await sync.status()).connected,true);assert.ok(saved.session.refresh_token);
  // SDK expires_at uses the wall clock; force the saved token into the past.
  time=Math.max(time,saved.session.expires_at*1000)+1000;
  await sync.action('enable',{confirmed:true});
  assert.equal((await sync.status()).phase,'idle');assert.ok(calls.some(c=>c.url.includes('grant_type=refresh_token')));
  assert.equal(JSON.stringify(await sync.status()).includes('private-rotated'),false);sync.close();
});

test('managed deployment presets work without user setup, rotate public keys, and reject project changes for a bound account',async()=>{
  const engine=createEngine({save:async()=>{}});let saved=null;
  const options={engine,load:async()=>saved,save:async s=>{saved=structuredClone(s);},defaultConfig:config,schedule:false,authFactory:authFactory()};
  const sync=createCloudSync(options);
  assert.equal((await sync.status()).configured,true);assert.equal((await sync.status()).managed,true);
  await assert.rejects(sync.action('configure',{...config,url:'https://otherproject.supabase.co'}),/统一管理/);
  await sync.action('send-code',{email:'a@example.com'});await sync.action('verify',{email:'a@example.com',code:'123456'});
  assert.equal(saved.config.url,config.url);
  const rotated=createCloudSync({...options,defaultConfig:{...config,publishableKey:'sb_publishable_rotated_public_only'}});
  assert.equal((await rotated.status()).connected,true);await rotated.action('disable');
  assert.equal(saved.config.publishableKey,'sb_publishable_rotated_public_only');
  const moved=createCloudSync({...options,defaultConfig:{...config,url:'https://otherproject.supabase.co'}});
  await assert.rejects(moved.status(),/迁移原同步账号/);
  assert.equal(saved.owner.project,config.url);sync.close();rotated.close();moved.close();
});

test('background cloud requests do not block learning; HTTP status never exposes tokens and cross-site sync writes fail',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'lsc-sync-http-'));
  let release,entered,hold=false;
  const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const api=await createAPI({directory,codex:{close(){},status:async()=>({loggedIn:false})},syncOptions:{schedule:false,authFactory:authFactory(),transport:async()=>{if(hold){entered();await wait;}return Response.json([]);}}});
  const server=createServer((req,res)=>api(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  // Windows may assign a dynamic port forbidden by WHATWG fetch (e.g. 6666).
  // Use the native HTTP client so the isolation check doesn't fail randomly.
  const call=(route,body,origin=base)=>new Promise((resolve,reject)=>{
    const req=httpRequest(`${base}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Coach-Request':'1'}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>resolve(new Response(text,{status:res.statusCode,headers:res.headers})));res.on('error',reject);
    });
    req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('Test HTTP request timed out')));req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const post=call;
  try {
    assert.equal((await post('sync/configure',config,'https://untrusted.example')).status,403);
    await post('sync/configure',config);await post('sync/verify',{email:'a@example.com',code:'123456'});await post('sync/enable',{confirmed:true});
    hold=true;const pending=post('sync/run',{});await started;
    assert.equal((await post('settings',{provider:'openai',model:'test-only',apiKey:'private-test-key'})).status,200);
    release();assert.equal((await pending).status,200);
    const status=await (await call('sync/status')).text();assert.equal(status.includes('test-access'),false);assert.equal(status.includes('test-refresh'),false);
  } finally {
    release();api.close();await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});
  }
});
