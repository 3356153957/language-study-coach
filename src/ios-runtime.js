// Headless learning engine for SwiftUI. No DOM, HTML or WebView is used.
import './ios-polyfills.js';
import { createEngine } from '../server/engine.js';
import { providers, callModel, AppError } from '../server/providers.js';
import { createCloudSync } from '../server/cloud-sync.js';
import { createChatGPTAuth } from '../server/chatgpt-auth.js';

const load = name => JSON.parse(__nativeLoad(name) || 'null');
const save = (name,value) => { const error=__nativeSave(name,JSON.stringify(value));if(error)throw new AppError(error); };
const invoke=(action,input={})=>globalThis.nativeInvoke(action,input);
const auth=createChatGPTAuth({load:()=>load('chatgpt-auth'),save:value=>save('chatgpt-auth',value),identityVerifier:input=>invoke('verifyIdentity',input)});
const engine=createEngine({initialState:load('learning-state') || undefined,save:value=>save('learning-state',value),availableProviders:Object.fromEntries(Object.entries(providers).filter(([id])=>id!=='codex')),allowImport:false,
  modelCall:(config,system,context)=>config?.provider==='chatgpt'?auth.complete(config,system,context):callModel(config,system,context)});
const config=JSON.parse(__nativeConfig());
const otpClient=(url,key)=>({auth:{
  signInWithOtp:async({email,options})=>otp(url,key,'otp',{email,create_user:options?.shouldCreateUser!==false,gotrue_meta_security:{captcha_token:options?.captchaToken}}),
  verifyOtp:async input=>otp(url,key,'verify',input),
  refreshSession:async({refresh_token})=>otp(url,key,'token?grant_type=refresh_token',{refresh_token}),
}});
async function otp(url,key,path,body) {
  const response=await fetch(`${url}/auth/v1/${path}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)return {error:{status:response.status}};
  if(data.access_token) {data.expires_at ||= Math.floor(Date.now()/1000)+data.expires_in;return {data:{session:data}};}
  return {data};
}
const sync=createCloudSync({engine,defaultConfig:config.url?config:undefined,load:()=>load('cloud-sync'),save:value=>save('cloud-sync',value),authFactory:otpClient});
const options={compact:true,timeZone:__nativeTimeZone()};
globalThis.studyRequest=async(path,body)=>{
  if(path==='state')return engine.view(options);
  if(path==='profile')return engine.profile();
  if(path==='activity')return engine.activity(body?.offset || 0);
  if(path==='review')return engine.review(body.goal,body.offset || 0);
  if(path==='session/detail')return engine.detail(body.id);
  if(path==='data/export')return engine.backup();
  if(path==='data/preview')return engine.previewImport(body.backup);
  if(path==='sync/status')return sync.status();
  if(path.startsWith('sync/'))return {...await sync.action(path.slice(5),body || {}),state:engine.view(options)};
  if(path==='chatgpt/status')return auth.status();
  if(path==='chatgpt/models')return {models:await auth.models()};
  if(path==='chatgpt/login') {
    const {redirectURI}=await invoke('prepareAuth');
    try {const {url}=await auth.start(redirectURI,body?.accountId);const {callbackURL}=await invoke('openAuth',{url});return await auth.finish(callbackURL);}
    finally {await invoke('cancelAuth');auth.cancel();}
  }
  if(path==='chatgpt/select')return auth.select(body.accountId);
  if(path==='chatgpt/logout')return auth.logout();
  if(['settings','settings/models'].includes(path) && !String(body?.baseURL || providers[body?.provider]?.baseURL || '').startsWith('https://'))throw new AppError('手机 API 地址须使用 HTTPS。');
  if(path==='settings/models')return engine.models(body);
  if(path==='settings' && body.provider==='chatgpt' && !(await auth.status()).loggedIn)throw new AppError('请先授权 ChatGPT 账号。');
  if(path==='session/start' && body.placement)throw new AppError('请从日常练习开始。');
  const result=await engine.execute(`/api/${path}`,body || {},options);
  if(path.startsWith('session/') || path==='data/import')sync.notifyChange();
  return result;
};
globalThis.studySnapshot=()=>JSON.stringify(engine.view(options));
globalThis.studyForeground=async()=>{const status=await sync.status();if(status.enabled)await sync.action('run',{});};
