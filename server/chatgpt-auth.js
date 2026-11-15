import { createLocalJWKSet, jwtVerify } from 'jose';
import { AppError, parseJSON } from './providers.js';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

// Platform adapters own the callback listener and protected credential storage.
// Tokens never appear in status responses, learner backups, or browser storage.
export function createChatGPTAuth({ load, save, transport = fetch, now = Date.now }) {
  let credentials, pending, keys, refreshing;
  async function state() {
    if (!credentials) {
      credentials = await load() || { hostId: `urn:uuid:${crypto.randomUUID()}`, accounts: [], activeId: null };
      if (!credentials.hostId || !Array.isArray(credentials.accounts)) throw new AppError('ChatGPT 授权记录无法读取。');
      await save(credentials);
    }
    return credentials;
  }
  async function commit(next) { await save(next); credentials = next; }
  const selected = s => s.accounts.find(a => a.id === s.activeId);
  async function http(url, options = {}) {
    try { return await transport(url, { ...options, signal: AbortSignal.timeout(60000), redirect: 'error' }); }
    catch { throw new AppError('无法连接 ChatGPT 授权服务，请检查网络后重试。', 502); }
  }
  async function tokenRequest(params) {
    const response = await http(`${issuer}/api/accounts/oauth/token`, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams(params).toString() });
    if (!response.ok) throw new AppError('ChatGPT 授权已失效或未获批准，请重新登录。', 401);
    const t = await response.json();
    if (!t.access_token || !t.refresh_token || !Number.isFinite(t.expires_in) || t.token_type?.toLowerCase() !== 'bearer') throw new AppError('ChatGPT 返回的授权不完整，请重新登录。', 502);
    return t;
  }
  async function validateIdentity(token, clientId, nonce) {
    if (!keys) {
      const response = await http(`${issuer}/.well-known/jwks.json`);
      if (!response.ok) throw new AppError('暂时无法验证 ChatGPT 身份，请重试。', 502);
      keys = createLocalJWKSet(await response.json());
    }
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: clientId, algorithms:['RS256'], requiredClaims:['sub','exp','iat','nonce'], currentDate:new Date(now()) });
      if (payload.nonce !== nonce || typeof payload.sub !== 'string') throw new Error();
      return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
    } catch { keys = null; throw new AppError('ChatGPT 身份校验失败，本次授权未保存。', 401); }
  }
  async function status() {
    const s = await state(), a = selected(s);
    return { loggedIn: !!a?.access_token, activeId: s.activeId,
      accounts: s.accounts.map(a => ({ id:a.id, label:a.email || 'ChatGPT 账号', connected:!!a.access_token })),
      account: a ? { id:a.id, label:a.email || 'ChatGPT 账号' } : null,
      login: pending ? { state:'pending' } : null };
  }
  async function start(redirectURI, accountId) {
    const uri = new URL(redirectURI);
    if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1' || uri.pathname !== '/auth/callback' || uri.search || uri.hash || uri.username || uri.password) throw new AppError('授权回调地址必须是本机回环地址。');
    const s = await state(), account = accountId ? s.accounts.find(a => a.id === accountId) : null;
    if (accountId && !account) throw new AppError('找不到保存的 ChatGPT 账号。');
    const verifier = random(), nonce = random(), oauthState = random();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const clientId = account?.client_id || 'dynamic_agent_client';
    pending = { verifier, nonce, state:oauthState, redirectURI, clientId, accountId:account?.id, expires:now()+10*60000 };
    const params = new URLSearchParams({ client_id:clientId, ext_agent_host_id:s.hostId, response_type:'code', redirect_uri:redirectURI, scope:scopes, resource, state:oauthState, nonce, code_challenge_method:'S256', code_challenge:challenge });
    if (account) { if (account.id_token) params.set('id_token_hint',account.id_token); }
    else params.set('agent_name_hint','Language Study Coach');
    return { url:`${issuer}/api/accounts/authorize?${params}` };
  }
  async function finish(callbackURL) {
    const attempt = pending;
    if (!attempt || attempt.expires < now()) throw new AppError('本次授权已过期，请重新登录。');
    const url = new URL(callbackURL), expected = new URL(attempt.redirectURI);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.get('state') !== attempt.state) throw new AppError('授权回调校验失败。', 401);
    pending = null;
    if (url.searchParams.has('error')) throw new AppError('未授予 ChatGPT 使用权限，可重新登录后批准。', 401);
    const clientId = url.searchParams.get('client_id') || (attempt.clientId !== 'dynamic_agent_client' ? attempt.clientId : '');
    if (!clientId || clientId === 'dynamic_agent_client' || (attempt.clientId !== 'dynamic_agent_client' && attempt.clientId !== clientId)) throw new AppError('ChatGPT 注册标识无效，本次授权未保存。', 401);
    const code = url.searchParams.get('code');
    if (!code || code.length > 8192) throw new AppError('授权码无效。');
    const t = await tokenRequest({ grant_type:'authorization_code', client_id:clientId, code, code_verifier:attempt.verifier, redirect_uri:attempt.redirectURI, resource });
    const identity = await validateIdentity(t.id_token,clientId,attempt.nonce);
    const granted = String(t.scope || '').split(' ');
    if (!granted.includes('chatgpt.tokens.use.direct')) throw new AppError('尚未允许使用 ChatGPT 订阅额度，请重新登录并批准该权限。', 403);
    const s = await state(), old = s.accounts.find(a=>a.id === attempt.accountId);
    if (old && (old.subject !== identity.subject || old.client_id !== clientId)) throw new AppError('登录账号与选择的账号不同，原授权未覆盖。', 401);
    const id = old?.id || s.accounts.find(a=>a.subject===identity.subject && a.client_id===clientId)?.id || crypto.randomUUID();
    const account = { id, ...identity, client_id:clientId, access_token:t.access_token, refresh_token:t.refresh_token, id_token:t.id_token, scopes:granted, expiresAt:now()+t.expires_in*1000 };
    await commit({ ...s, activeId:id, accounts:[...s.accounts.filter(a=>a.id!==id),account] });
    return status();
  }
  async function accessToken() {
    const s = await state(), a = selected(s);
    if (!a?.access_token) throw new AppError('请先使用 ChatGPT 账号登录。', 401);
    if (a.expiresAt > now()+60000) return a.access_token;
    if (!refreshing) refreshing = (async () => {
      const t = await tokenRequest({ grant_type:'refresh_token', client_id:a.client_id, refresh_token:a.refresh_token, resource });
      const granted = t.scope ? t.scope.split(' ') : a.scopes;
      if (!granted.includes('chatgpt.tokens.use.direct')) throw new AppError('ChatGPT 订阅授权已撤销，请重新登录。', 401);
      const updated = { ...a, access_token:t.access_token, refresh_token:t.refresh_token, scopes:granted, expiresAt:now()+t.expires_in*1000 };
      await commit({ ...s, accounts:s.accounts.map(x=>x.id===a.id?updated:x) });
      return updated.access_token;
    })().finally(()=>{ refreshing=null; });
    return refreshing;
  }
  async function models() {
    const token = await accessToken();
    const response = await http(`${resource}/models`, { headers:{Authorization:`Bearer ${token}`} });
    if (!response.ok) throw new AppError('无法读取 ChatGPT 可用模型，请重新登录或稍后重试。',502);
    const result = await response.json();
    return (result.models || []).filter(m=>m.visibility==='list' && typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name || m.slug}));
  }
  async function complete(config, instructions, context) {
    const token = await accessToken();
    const model = config.model || (await models())[0]?.id;
    if (!model) throw new AppError('此 ChatGPT 账号没有可用模型，请检查订阅权限。',409);
    const response = await http(`${resource}/responses`, { method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions,input:[{role:'user',content:JSON.stringify(context)}],store:false,stream:true}) });
    if (!response.ok) throw new AppError(response.status===429 ? 'ChatGPT 额度不足，请到 ChatGPT 用量设置查看，或切换 API。' : 'ChatGPT 请求失败，请检查授权与账号权限。',502);
    return parseJSON(await consumeResponseStream(response));
  }
  return { status,start,finish,models,complete,cancel(){pending=null;},
    async select(id) { if(refreshing) await refreshing; const s=await state(); if(!s.accounts.some(a=>a.id===id && a.access_token)) throw new AppError('请重新授权该账号。'); await commit({...s,activeId:id}); return status(); },
    async logout() {
      if(refreshing) await refreshing;
      const s=await state(),a=selected(s); let revoked=true;
      if(a?.refresh_token) try {
        const r=await http(`${issuer}/api/accounts/oauth/revoke`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:a.refresh_token,token_type_hint:'refresh_token',client_id:a.client_id}).toString()}); revoked=r.ok;
      } catch { revoked=false; }
      await commit({...s,activeId:null,accounts:s.accounts.map(x=>x.id===a?.id?{id:x.id,email:x.email,subject:x.subject,client_id:x.client_id}:x)});
      return {...await status(),message:revoked?'已退出 ChatGPT 授权。':'已在本机退出；远端撤销未确认，请到 ChatGPT 设置断开此应用。'};
    },
  };
}

export async function consumeResponseStream(response) {
  let reader, buffer='', result='', completed=false;
  function event(block) {
    const raw=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!raw || raw==='[DONE]') return;
    let e; try{e=JSON.parse(raw);}catch{throw new AppError('ChatGPT 数据流格式不正确，请重试。',502);}
    if(e.type==='response.output_text.delta') result+=e.delta || '';
    if(['response.failed','response.incomplete','error'].includes(e.type)) throw new AppError('ChatGPT 未完成回答或额度已用尽，请检查用量后重试。',502);
    if(e.type==='response.completed') completed=true;
  }
  function chunk(text) { buffer+=text.replace(/\r\n/g,'\n'); let index; while((index=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+2);} if(buffer.length+result.length>2_000_000) throw new AppError('ChatGPT 回答过长。',502); }
  if(response.body?.getReader) {
    reader=response.body.getReader();const decoder=new TextDecoder();
    try { while(true){const {value,done}=await reader.read();if(done)break;chunk(decoder.decode(value,{stream:true}));} chunk(decoder.decode()); }
    catch(e){await reader.cancel().catch(()=>{});throw e;} finally{reader.releaseLock();}
  } else chunk(await response.text());
  if(buffer.trim()) event(buffer);
  if(!completed) throw new AppError('ChatGPT 连接中断，回答未保存，请重试。',502);
  return result;
}
