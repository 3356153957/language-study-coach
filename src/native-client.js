import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { createEngine } from '../server/engine.js';
import { AppError, providers, callModel } from '../server/providers.js';
import { createChatGPTAuth } from '../server/chatgpt-auth.js';
import { createCloudSync } from '../server/cloud-sync.js';

const storage = registerPlugin('StudyStorage');
const device = registerPlugin('StudyDevice');
export const mobileProviders = Object.fromEntries(Object.entries(providers).filter(([key]) => key !== 'codex'));

export function nativeFetcher(http = CapacitorHttp) {
  return async (url, options) => {
    const result = await http.request({ url, method: options.method, headers: options.headers,
      ...(options.body === undefined ? {} : {data: JSON.parse(options.body)}), responseType: 'json', connectTimeout: 15000,
      readTimeout: options.method === 'GET' ? 15000 : 60000, disableRedirects: true });
    return { ok: result.status >= 200 && result.status < 300, status: result.status,
      json: async () => typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
  };
}

export function nativeAuthTransport(http = CapacitorHttp) {
  return async (url, options={}) => {
    const type=options.headers?.['Content-Type'] || '';
    // Keep OAuth form strings byte-for-byte encoded (not encoded twice by the
    // native adapter); use the adapter's structured encoding for Responses JSON.
    const data=options.body===undefined ? undefined : type.includes('application/json') ? JSON.parse(options.body) : options.body;
    const r=await http.request({url,method:options.method || 'GET',headers:options.headers || {},data,responseType:'text',connectTimeout:15000,readTimeout:60000,disableRedirects:true});
    return {ok:r.status>=200 && r.status<300,status:r.status,json:async()=>typeof r.data==='string'?JSON.parse(r.data):r.data,text:async()=>typeof r.data==='string'?r.data:JSON.stringify(r.data)};
  };
}

export function nativeSyncTransport(http = CapacitorHttp) {
  return async(url,options={})=>{
    const headers=Object.fromEntries(new Headers(options.headers).entries());
    const data=options.body===undefined?undefined:headers['content-type']?.includes('application/json')?JSON.parse(options.body):options.body;
    const r=await http.request({url,method:options.method || 'GET',headers,data,responseType:'text',connectTimeout:15000,readTimeout:20000,disableRedirects:true});
    return new Response([204,205,304].includes(r.status) || options.method==='HEAD'?null:typeof r.data==='string'?r.data:JSON.stringify(r.data),{status:r.status,headers:r.headers});
  };
}

export async function createNativeClient({ store = storage, deviceBridge = device, compact = false, timeZone = 'UTC', chatgpt, syncOptions={}, modelFetcher = nativeFetcher(),
  modelCall = (config, system, context) => config?.provider==='chatgpt' ? auth.complete(config,system,context) : callModel(config, system, context, nativeFetcher()) } = {}) {
  const auth=chatgpt || createChatGPTAuth({load:async()=>{const {value}=await store.loadAuth();return value?JSON.parse(value):null;},save:async value=>{await store.saveAuth({value:JSON.stringify(value)});},transport:nativeAuthTransport()});
  let initialState;
  try {
    const { value } = await store.load();
    if (value) {
      initialState = JSON.parse(value);
      if (initialState.version !== 1 || !Array.isArray(initialState.sessions)) throw new Error();
    }
  } catch { throw new AppError('手机学习记录无法读取。请重新打开应用；不要卸载，以免丢失记录。'); }
  const engine = createEngine({ initialState, modelCall, modelFetcher, availableProviders: mobileProviders, allowImport: false,
    save: async state => {
      try { await store.save({ value: JSON.stringify(state) }); }
      catch { throw new AppError('手机存储失败，原有记录未覆盖，请检查可用空间后重试。'); }
    } });
  const sync=createCloudSync({engine,transport:nativeSyncTransport(),
    defaultConfig:import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ? {url:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}:undefined,
    load:async()=>{const {value}=await store.loadSync();return value?JSON.parse(value):null;},
    save:async value=>{await store.saveSync({value:JSON.stringify(value)});},...syncOptions});
  return { async request(path, body) {
    const url = new URL(path, 'https://local/'); path = url.pathname.slice(1);
    if (path === 'state' && body === undefined) return engine.view({ compact, timeZone });
    if (path === 'profile' && body === undefined) return engine.profile();
    if (path === 'activity' && body === undefined) return engine.activity(url.searchParams.get('offset'));
    if (path === 'session/detail' && body === undefined) return engine.detail(url.searchParams.get('id'));
    if (path === 'review' && body === undefined) return engine.review(url.searchParams.get('goal'), url.searchParams.get('offset'));
    if (path === 'data/export' && body === undefined) return engine.backup();
    if (path === 'data/preview') return engine.previewImport(body.backup);
    if(path==='sync/status') return sync.status();
    if(path.startsWith('sync/')) return {...await sync.action(path.slice(5),body || {}),state:engine.view({compact,timeZone})};
    if (path === 'chatgpt/status') return auth.status();
    if (path === 'chatgpt/models') return {models:await auth.models()};
    if (path === 'chatgpt/login') {
      const {redirectURI}=await deviceBridge.prepareAuth();
      try {const {url}=await auth.start(redirectURI,body?.accountId); const {callbackURL}=await deviceBridge.openAuth({url});return await auth.finish(callbackURL);}
      finally {await deviceBridge.cancelAuth();auth.cancel();}
    }
    if (path === 'chatgpt/cancel') {await deviceBridge.cancelAuth();auth.cancel();return auth.status();}
    if (path === 'chatgpt/logout') return auth.logout();
    if (path === 'chatgpt/select') return auth.select(body.accountId);
    if (path.startsWith('codex/') || path === 'background/import') throw new AppError('手机独立版不提供此功能。', 404);
    if (path === 'session/start' && body?.placement) throw new AppError('请从日常练习开始。');
    if (['settings','settings/models'].includes(path) && !String(body?.baseURL || mobileProviders[body?.provider]?.baseURL || '').startsWith('https://')) throw new AppError('手机 API 地址须使用 HTTPS。');
    if (path === 'settings/models') return engine.models(body || {});
    if (path === 'settings' && body?.provider==='chatgpt' && !(await auth.status()).loggedIn) throw new AppError('请先使用 ChatGPT 登录，再启用。',409);
    const result=await engine.execute(`/api/${path}`, body || {}, { compact, timeZone });
    if(path.startsWith('session/') || path==='data/import') sync.notifyChange();
    return result;
  },close(){sync.close();} };
}
