import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createChatGPTAuth, consumeResponseStream } from '../server/chatgpt-auth.js';

const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'test',alg:'RS256',use:'sig'};
function harness() {
 let saved=null,authURL,invalidNonce=false,invalidAudience=false,denyScope=false,unsupportedRegion=false,refreshes=0,time=Date.now(),refreshFailure=false;
 const calls=[];
 const transport=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/oauth/token')) {
   if(unsupportedRegion)return Response.json({error:{code:'unsupported_country_region_territory'}},{status:403});
   const p=new URLSearchParams(options.body),refresh=p.get('grant_type')==='refresh_token';
   if(refresh) {refreshes++;if(refreshFailure)return Response.json({error:'invalid_grant'},{status:400});}
   const idToken=await new SignJWT({nonce:invalidNonce?'bad':authURL.searchParams.get('nonce'),email:'learner@example.test'})
    .setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('learner').setIssuer('https://auth.openai.com').setAudience(invalidAudience?'wrong':p.get('client_id')).setIssuedAt(Math.floor(time/1000)).setExpirationTime(Math.floor(time/1000)+3600).sign(pair.privateKey);
   return Response.json({access_token:refresh?'refreshed-token':'access-token',refresh_token:refresh?'rotated-refresh':'refresh-token',id_token:idToken,token_type:'Bearer',expires_in:3600,scope:denyScope?'openid email':'openid email offline_access chatgpt.tokens.use.direct'});
  }
  if(url.endsWith('/models'))return Response.json({models:[{slug:'test-model',display_name:'Test',visibility:'list'},{slug:'hidden',visibility:'hide'}]});
  if(url.endsWith('/responses'))return new Response('data: {"type":"response.output_text.delta","delta":"{\\"ok\\":true}"}\n\ndata: {"type":"response.completed"}\n\n');
  if(url.endsWith('/oauth/revoke'))return new Response(null,{status:200});
  throw new Error('Unexpected URL');
 };
 const create=()=>createChatGPTAuth({load:async()=>saved,save:async s=>{saved=structuredClone(s);},transport,now:()=>time});
 const auth=create();
  return {auth,create,calls,saved:()=>saved,refreshes:()=>refreshes,
  set invalidNonce(v){invalidNonce=v;},set invalidAudience(v){invalidAudience=v;},set denyScope(v){denyScope=v;},set unsupportedRegion(v){unsupportedRegion=v;},set refreshFailure(v){refreshFailure=v;},advance:()=>{time+=3600*1000;},
  async start(accountId){authURL=new URL((await auth.start('http://127.0.0.1:1455/auth/callback',accountId)).url);return authURL;},
  callback(overrides={}){const p=new URLSearchParams({state:authURL.searchParams.get('state'),code:'code',client_id:'issued-client',...overrides});return 'http://127.0.0.1:1455/auth/callback?'+p;},
 };
}

test('SIWC registers with PKCE, validates signed identity and scope, persists host, masks tokens, and uses completed Responses SSE',async()=>{
 const h=harness(),url=await h.start();
 assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('agent_name_hint'),'Language Study Coach');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge').length,43);
 const status=await h.auth.finish(h.callback());assert.equal(status.loggedIn,true);assert.equal(status.account.label,'learner@example.test');
 assert.equal(JSON.stringify(status).includes('token'),false);
 assert.equal((await h.auth.models()).length,1);
 assert.deepEqual(await h.auth.complete({model:'test-model'},'Return JSON',{x:1}),{ok:true});
 const body=JSON.parse(h.calls.find(c=>c.url.endsWith('/responses')).options.body);
 assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.instructions,'Return JSON');assert.equal('max_output_tokens' in body,false);
 const host=h.saved().hostId;await h.create().status();assert.equal(h.saved().hostId,host);
 const returning=await h.start(status.activeId);assert.equal(returning.searchParams.get('client_id'),'issued-client');assert.equal(returning.searchParams.has('agent_name_hint'),false);
});

test('unsupported region returns a clear fallback message',async()=>{
 const h=harness();await h.start();h.unsupportedRegion=true;
 await assert.rejects(h.auth.finish(h.callback()),/当前不支持.*地区.*API Key/);
 assert.equal(h.saved().accounts.length,0);
});

test('invalid state, issuer audience, nonce and missing plan consent never replace credentials',async()=>{
 for(const type of ['state','nonce','audience','scope']) {
  const h=harness();await h.start();if(type==='nonce')h.invalidNonce=true;if(type==='audience')h.invalidAudience=true;if(type==='scope')h.denyScope=true;
  await assert.rejects(h.auth.finish(h.callback(type==='state'?{state:'bad'}:{})));
  assert.equal(h.saved().accounts.length,0);
 }
 const h=harness();await assert.rejects(h.auth.start('https://attacker.test/auth/callback'));
 await h.start();await assert.rejects(h.auth.finish(h.callback({client_id:'dynamic_agent_client'})));
});

test('refresh rotation is serialized and revoked sessions fail without consuming another account',async()=>{
 const h=harness();await h.start();await h.auth.finish(h.callback());h.advance();
 await Promise.all([h.auth.models(),h.auth.models()]);assert.equal(h.refreshes(),1);assert.equal(h.saved().accounts[0].refresh_token,'rotated-refresh');
 h.advance();h.refreshFailure=true;await assert.rejects(h.auth.models(),/失效/);
 const status=await h.auth.logout();assert.equal(status.loggedIn,false);assert.equal(h.saved().accounts[0].refresh_token,undefined);
});

test('stream interruptions and failure after a partial answer are rejected instead of saved as success',async()=>{
 await assert.rejects(consumeResponseStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')),/连接中断/);
 await assert.rejects(consumeResponseStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.failed"}\n\n')),/未完成/);
 const bytes=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"完整"}\n\ndata: {"type":"response.completed"}\n\n');
 const stream=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});
 assert.equal(await consumeResponseStream(new Response(stream)),'完整');
});
