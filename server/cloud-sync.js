import { createClient } from '@supabase/supabase-js';
import { AppError } from './providers.js';
import { canonical, fingerprint, recordsFromBackup, recordKey, reconcile, validateRecord } from './sync-records.js';

export function validateSyncConfig(input) {
  let url;
  try { url=new URL(input.url); } catch { throw new AppError('请输入 Supabase 项目 URL。'); }
  if(url.protocol!=='https:' || !/^[a-z0-9]{6,64}\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname!=='/' || url.search || url.hash)
    throw new AppError('请使用官方 https://项目编号.supabase.co 地址。');
  const key=String(input.publishableKey || '').trim();
  let anon=false;
  if(key.length<4096 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    try { anon=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon'; } catch { /* Invalid public key. */ }
  }
  if(!/^sb_publishable_[\w-]{10,500}$/.test(key) && !anon) throw new AppError('仅接受 Publishable Key 或 anon 公开 Key，请勿填写 Secret Key。');
  return {url:url.origin,publishableKey:key};
}
const empty=()=>({version:1,config:null,session:null,owner:null,enabled:false,cursor:0,known:{},conflicts:{},lastSync:null});
const emailValue=value=>{
  const email=String(value || '').trim().toLowerCase();
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('请输入有效邮箱。');
  return email;
};

// Learning data and auth use different stores. Auth never leaves this controller.
export function createCloudSync({load,save,engine,transport=fetch,authFactory=createClient,now=()=>Date.now(),schedule=true,defaultConfig}) {
  let state,initializing,client,clientConfig,queue=Promise.resolve(),timer,closed=false,phase='idle',lastError='',epoch=0;
  let lastCodeAt=0,stopVersion=0;
  const init=()=>initializing ||= (async()=>{
    const value=await load();
    if(value && (value.version!==1 || typeof value.known!=='object' || typeof value.conflicts!=='object')) throw new AppError('同步配置无法读取，本机学习记录仍然保留。');
    state=value || empty();
    if(!state.config && defaultConfig) state.config=validateSyncConfig(defaultConfig);
    if(state.config) validateSyncConfig(state.config);
  })();
  const persist=async()=>save(structuredClone(state));
  const safeFetch=async(url,options={})=>{
    if(new URL(url).origin!==state.config.url) throw new AppError('同步请求地址不匹配。');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try { return await transport(url,{...options,signal:controller.signal,redirect:'error'}); }
    finally {clearTimeout(timeout);}
  };
  function auth() {
    if(!state.config) throw new AppError('请先连接同步服务。',409);
    const key=canonical(state.config);
    if(!client || clientConfig!==key) {
      client=authFactory(state.config.url,state.config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:safeFetch}});
      clientConfig=key;
    }
    return client.auth;
  }
  function storeSession(session) {
    const user=session?.user;
    if(!user?.id || !user.email || !session.access_token || !session.refresh_token || !Number.isFinite(session.expires_at)) throw new AppError('登录响应无效，请重新获取验证码。');
    if(state.owner && (state.owner.project!==state.config.url || state.owner.id!==user.id))
      throw new AppError('本机学习记录已绑定其他同步账号。为避免混入他人的数据，请使用原邮箱登录。',409);
    state.owner={id:user.id,email:user.email,project:state.config.url};
    state.session={access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at};
  }
  async function token() {
    if(!state.session) throw new AppError('请先登录同步账号。',401);
    if(state.session.expires_at*1000<now()+60000) {
      const {data,error}=await auth().refreshSession({refresh_token:state.session.refresh_token});
      if(error && ![400,401,403].includes(error.status)) throw new AppError('网络暂不可用，恢复连接后会继续同步。本机记录已保留。',502);
      if(error || !data?.session) throw new AppError('同步登录已过期，请用原邮箱重新登录。本机记录仍然保留。',401);
      storeSession(data.session);await persist();
    }
    return state.session.access_token;
  }
  async function rest(path,{method='GET',body,head=false}={}) {
    const access=await token();
    const response=await safeFetch(`${state.config.url}/rest/v1/${path}`,{method:head?'HEAD':method,headers:{apikey:state.config.publishableKey,Authorization:`Bearer ${access}`,'Content-Type':'application/json',...(head?{Prefer:'count=exact'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok) {
      let code;try{code=(await response.json()).code;}catch{/* Do not expose upstream error bodies. */}
      if(response.status===401) throw new AppError('同步登录已过期，请用原邮箱重新登录。',401);
      if(['PGRST202','PGRST205','42P01'].includes(code) || response.status===404) throw new AppError('同步数据表尚未就绪，请先执行项目提供的数据库脚本。',409);
      if(code==='22023' || response.status===413) throw new AppError('有一条记录超过同步上限（512 KB），本机内容已保留，请先导出备份。');
      if(response.status===403) throw new AppError('同步权限检查未通过，请核对数据库脚本和账号登录。',403);
      throw new AppError('暂时无法连接同步服务，稍后会重试。本机记录已保留。',502);
    }
    if(head) return Number(response.headers.get('content-range')?.split('/')[1]) || 0;
    const text=await response.text();
    if(text.length>16*1024*1024) throw new AppError('云端响应过大，已暂停本次同步。');
    try{return JSON.parse(text);}catch{throw new AppError('同步服务响应无效，本机记录未覆盖。');}
  }
  function row(value) {
    if(!Number.isSafeInteger(value?.revision) || value.revision<1) throw new AppError('云端版本号无效，本机记录未覆盖。');
    return {...validateRecord(value),revision:value.revision};
  }
  function later(delay) {
    clearTimeout(timer);
    if(schedule && !closed && state?.enabled) {timer=setTimeout(()=>{action('run').catch(()=>{});},delay);timer.unref?.();}
  }
  async function accept(rows) {
    const local=new Map(recordsFromBackup(engine.backup()).map(r=>[recordKey(r),r])),changes=[];
    const known={...state.known},conflicts={...state.conflicts};
    for(const remote of rows) {
      const key=recordKey(remote),merged=reconcile(local.get(key),remote);
      known[key]={revision:remote.revision,hash:await fingerprint(remote.payload)};
      if(!merged) { conflicts[key]={record:remote,revision:remote.revision};continue; }
      delete conflicts[key];changes.push(merged);local.set(key,merged);
    }
    // Engine obtains its own transaction lock and rechecks the current state.
    // Cursor advances only after the local file has committed successfully.
    if(changes.length) await engine.mergeCloud(changes);
    state.known=known;state.conflicts=conflicts;
  }
  async function synchronize() {
    if(!state.enabled || !state.session) return;
    const started=epoch,stopAt=stopVersion;phase='syncing';lastError='';
    try {
      // Reconsider preserved conflicts after a manual backup merge.
      await accept(Object.values(state.conflicts).map(c=>c.record));
      for(let page=0;page<500;page++) {
        if(!state.enabled || stopAt!==stopVersion) break;
        const data=await rest(`lsc_sync_records?select=kind,id,payload,revision&revision=gt.${state.cursor}&order=revision.asc&limit=25`);
        if(!Array.isArray(data) || data.length>25) throw new AppError('云端记录列表无效。');
        const rows=data.map(row);
        if(rows.some((r,i)=>r.revision<=(i?rows[i-1].revision:state.cursor))) throw new AppError('云端记录顺序无效。');
        await accept(rows);
        if(rows.length) {state.cursor=rows.at(-1).revision;await persist();}
        if(rows.length<25) break;
        if(page===499) throw new AppError('记录较多，请再次同步以继续。');
      }
      for(const local of recordsFromBackup(engine.backup())) {
        if(!state.enabled || stopAt!==stopVersion) break;
        const key=recordKey(local),known=state.known[key];
        if(state.conflicts[key] || known?.hash===await fingerprint(local.payload)) continue;
        const result=await rest('rpc/lsc_sync_apply',{method:'POST',body:{p_kind:local.kind,p_id:local.id,p_payload:local.payload,p_expected:known?.revision || 0}});
        const remote=row(result.record);
        if(recordKey(remote)!==key) throw new AppError('云端返回了不匹配的记录。');
        if(result.applied===true) {
          if(canonical(remote.payload)!==canonical(local.payload)) throw new AppError('云端确认内容不匹配。');
          state.known[key]={revision:remote.revision,hash:await fingerprint(remote.payload)};
        } else if(result.applied===false) {await accept([remote]);epoch++;}
        else throw new AppError('云端确认格式无效。');
        await persist();
      }
      if(state.enabled && stopAt===stopVersion) state.lastSync=new Date(now()).toISOString();
      await persist();phase='idle';
      if(epoch!==started) later(2000);
    } catch(error) {
      phase='error';lastError=error instanceof AppError?error.message:'网络暂不可用，恢复连接后会继续同步。本机记录已保留。';
      later(30000);
    }
  }
  async function status() {
    await init();
    return {configured:!!state.config,managed:!!defaultConfig && defaultConfig.url===state.config?.url,url:state.config?.url || '',connected:!!state.session,email:state.owner?.email || '',enabled:state.enabled,phase,lastError,lastSync:state.lastSync,
      conflicts:Object.values(state.conflicts).map(c=>({kind:c.record.kind,id:c.record.id})),bound:!!state.owner};
  }
  async function perform(name,input={},requestedStop=stopVersion) {
    await init();
    if(name==='configure') {
      const config=validateSyncConfig(input);
      if(state.owner && state.owner.project!==config.url) throw new AppError('本机记录已绑定原同步项目，请使用原项目地址。',409);
      state.config=config;state.enabled=false;lastError='';client=null;await persist();
    } else if(name==='send-code') {
      const email=emailValue(input.email);
      if(state.owner && email!==state.owner.email.toLowerCase()) throw new AppError('请使用本机已绑定的邮箱登录，避免混入其他账号的数据。',409);
      if(lastCodeAt && now()-lastCodeAt<60000) throw new AppError('验证码已发送，请稍等一分钟后再试。',429);
      const {error}=await auth().signInWithOtp({email,options:{shouldCreateUser:true}});
      if(error) throw new AppError('验证码未能发送，请检查项目邮件设置或稍后重试。');
      lastCodeAt=now();
    } else if(name==='verify') {
      const email=emailValue(input.email),code=String(input.code || '').trim();
      if(!/^\d{6,8}$/.test(code)) throw new AppError('请输入邮件中的 6 至 8 位验证码。');
      const {data,error}=await auth().verifyOtp({email,token:code,type:'email'});
      if(error || !data?.session) throw new AppError('验证码无效或已过期，请重新获取。');
      storeSession(data.session);state.enabled=false;lastError='';await persist();
    } else if(name==='preview') {
      if(!state.session) throw new AppError('请先登录同步账号。',401);
      const d=engine.backup().data;
      const cloudRecords=await rest('lsc_sync_records?select=id',{head:true});
      return {status:await status(),preview:{rounds:d.sessions.length,answers:d.sessions.reduce((n,s)=>n+s.history.length,0),cloudRecords}};
    } else if(name==='enable') {
      if(!state.session || input.confirmed!==true) throw new AppError('请先确认要同步的学习数据。',409);
      if(requestedStop!==stopVersion) return {status:await status()};
      state.enabled=true;await persist();await synchronize();
    } else if(name==='disable' || name==='logout') {
      state.enabled=false;clearTimeout(timer);
      if(name==='logout') {state.session=null;client=null;}
      phase='idle';lastError='';await persist();
    } else if(name==='run') await synchronize();
    else throw new AppError('同步操作不存在。',404);
    return {status:await status()};
  }
  function action(name,input) {
    // Pause stops the next network request immediately, even if queued behind a
    // slow sync. The in-flight request may finish; token removal remains serial.
    if(name==='disable' || name==='logout') {stopVersion++;if(state)state.enabled=false;clearTimeout(timer);}
    const requestedStop=stopVersion,result=queue.then(()=>perform(name,input,requestedStop));
    queue=result.catch(()=>{});return result;
  }
  return {status,action,notifyChange(){epoch++;later(2000);},close(){closed=true;clearTimeout(timer);}};
}
