import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError, callModel } from './providers.js';
import { CodexBridge } from './codex.js';
import { createEngine } from './engine.js';
import { createChatGPTAuth } from './chatgpt-auth.js';
import { backupLimit } from './backup.js';
import { createCloudSync } from './cloud-sync.js';

export async function createAPI({ directory, modelCall, modelFetcher = fetch, codex = new CodexBridge({ directory }), chatgpt, syncOptions={} } = {}) {
  chatgpt ||= createChatGPTAuth({
    load:async()=>{try{return JSON.parse(await readFile(path.join(directory,'chatgpt-auth.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new AppError('ChatGPT 授权文件无法读取。');}},
    save:async value=>{await mkdir(directory,{recursive:true});const file=path.join(directory,'chatgpt-auth.json');await writeFile(`${file}.tmp`,JSON.stringify(value),{mode:0o600});await rename(`${file}.tmp`,file);},
  });
  modelCall ||= (config, system, context) => config?.provider === 'chatgpt' ? chatgpt.complete(config,system,context) : config?.provider === 'codex' ? codex.complete(config, system, context) : callModel(config, system, context);
  const file = path.join(directory, 'state.json');
  let state = { version: 1, config: null, profiles: {}, sessions: [] };
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('学习数据无法读取，请保留 .local/state.json 并检查文件。'); }
  let busy = false, chatgptLoginError = '';
  const authAbuse = new Map();
  function checkAuthRate(req, route) {
    const now = Date.now(), address = req.socket?.remoteAddress || 'unknown', key = `${route}:${address}`, windowMs = route.endsWith('send-code') ? 60*60*1000 : 15*60*1000, limit = route.endsWith('send-code') ? 20 : 40;
    for (const [k,v] of authAbuse) if (now-v.startedAt > windowMs) authAbuse.delete(k);
    const current = authAbuse.get(key);
    if (!current || now-current.startedAt > windowMs) { authAbuse.set(key,{startedAt:now,count:1,lastAt:now}); return; }
    if (route.endsWith('send-code') && now-current.lastAt < 15000) throw new AppError('请求过于频繁，请稍后再试。',429);
    if (current.count >= limit) throw new AppError('请求过于频繁，请稍后再试。',429);
    current.count++; current.lastAt=now;
  }
  const engine = createEngine({ initialState: state, modelCall, modelFetcher, codex, save: async draft => {
    await mkdir(directory, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(draft, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }});
  const sync=createCloudSync({engine,
    load:async()=>{try{return JSON.parse(await readFile(path.join(directory,'cloud-sync.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new AppError('同步配置无法读取，请保留原文件后重试。');}},
    save:async value=>{await mkdir(directory,{recursive:true});const f=path.join(directory,'cloud-sync.json');await writeFile(`${f}.tmp`,JSON.stringify(value),{mode:0o600});await rename(`${f}.tmp`,f);},
    ...syncOptions});
  const api = async function (req, res, nextHandler) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const viewOptions = { compact: url.searchParams.get('compact') === '1', timeZone: url.searchParams.get('tz') || 'UTC' };
    if (!route.startsWith('/api/') && route!=='/auth/callback') return nextHandler();
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    let ownsLock = false;
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError('此版本仅允许从本机访问。', 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) throw new AppError('不允许跨站访问学习数据。', 403);
      if (req.method==='GET' && route==='/auth/callback') {
        let message='ChatGPT 授权成功，请返回 Language Study Coach。',status=200;
        try { await chatgpt.finish(`http://${host}${req.url}`); chatgptLoginError=''; } catch(e) {status=400;message=e instanceof AppError?e.message:'授权未能保存，请返回应用重试。';chatgptLoginError=message;}
        const returnPath = status === 200 ? '/?chatgpt=callback' : '/?chatgpt=error';
        res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'",'Referrer-Policy':'no-referrer'});
        return res.end(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="1;url=${returnPath}"><title>ChatGPT 授权</title><h1>${message}</h1><p>正在返回 Language Study Coach…</p><script>setTimeout(()=>location.replace('${returnPath}'),250);</script></html>`);
      }
      if (req.method === 'GET' && route === '/api/state') return send(200, engine.view(viewOptions));
      if (req.method === 'GET' && route === '/api/session/detail') return send(200, engine.detail(url.searchParams.get('id')));
      if (req.method === 'GET' && route === '/api/profile') return send(200, engine.profile(viewOptions));
      if (req.method === 'GET' && route === '/api/activity') return send(200, engine.activity(url.searchParams.get('offset')));
      if (req.method === 'GET' && route === '/api/review') return send(200, engine.review(url.searchParams.get('goal'), url.searchParams.get('offset'), {...viewOptions,filter:url.searchParams.get('filter')}));
      if (req.method === 'GET' && route === '/api/codex/status') return send(200, await codex.status());
      if (req.method === 'GET' && route === '/api/chatgpt/status') return send(200,{...await chatgpt.status(),loginError:chatgptLoginError});
      if (req.method === 'GET' && route === '/api/chatgpt/models') return send(200,{models:await chatgpt.models()});
      if (req.method === 'GET' && route === '/api/data/export') return send(200,engine.backup());
      if (req.method === 'GET' && route === '/api/sync/status') return send(200,await sync.status());
      if (req.method !== 'POST') throw new AppError('请求方法不支持。', 405);
      if (req.headers['x-coach-request'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) throw new AppError('请求来源或格式不正确。', 403);
      if (route === '/api/sync/send-code' || route === '/api/sync/verify') checkAuthRate(req, route);
      // Cloud network requests must not occupy the learning/API transaction lock.
      // Their short local merge obtains the engine's lock independently.
      if(!route.startsWith('/api/sync/') && route !== '/api/settings/models') {
        if (busy) throw new AppError('正在处理上一项请求，请稍后重试。', 409);
        busy = true; ownsLock = true;
      }
      let raw = '';
      const limit=route.startsWith('/api/data/')?backupLimit+1000:100000;
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > limit) throw new AppError('请求内容过长。', 413); }
      let input;
      try { input = JSON.parse(raw); } catch { throw new AppError('请求不是有效 JSON。'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('请求格式不正确。');
      if (route === '/api/settings/models') return send(200, await engine.models(input));
      if(route.startsWith('/api/sync/')) {
        const result=await sync.action(route.slice('/api/sync/'.length),input);
        return send(200,{...result,state:engine.view(viewOptions)});
      }
      if (route === '/api/chatgpt/login') { chatgptLoginError='';const port=new URL(`http://${host}`).port; return send(200,await chatgpt.start(`http://127.0.0.1:${port || 80}/auth/callback`,input.accountId)); }
      if (route === '/api/chatgpt/cancel') {chatgpt.cancel();return send(200,await chatgpt.status());}
      if (route === '/api/chatgpt/select') return send(200,await chatgpt.select(input.accountId));
      if (route === '/api/chatgpt/logout') return send(200,await chatgpt.logout());
      if (route === '/api/data/preview') return send(200,engine.previewImport(input.backup));
      if (route === '/api/settings' && input.provider==='chatgpt' && !(await chatgpt.status()).loggedIn) throw new AppError('请先使用 ChatGPT 登录，再启用。',409);
      if (route === '/api/codex/login') return send(200, await codex.loginStart(input.type));
      if (route === '/api/codex/login/cancel') { await codex.cancelLogin(); return send(200, await codex.status()); }
      const result=await engine.execute(route, input, viewOptions);
      if(route.startsWith('/api/session/') || route==='/api/data/import' || route==='/api/background/import' || route==='/api/learning-plan' || route.startsWith('/api/vocabulary/') || route==='/api/exam/assess' || route==='/api/profile/refresh') sync.notifyChange();
      send(200,result);
    } catch (error) {
      send(error.status || 500, { error: error instanceof AppError ? error.message : '本地服务处理失败，数据未更新，请检查磁盘空间后重试。' });
    } finally { if (ownsLock) busy = false; }
  };
  api.close = () => {sync.close();codex.close();};
  return api;
}
