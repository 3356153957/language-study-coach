import { renderWordbook } from './reading-words.js';
import { questionAnswers, updateQuestionAnswer } from './answer-input.js';
import { roundCounts } from '../server/answer-results.js';
import { renderAnswerReview } from './answer-review.js';
import { createDraftStore } from './draft-store.js';

import './style.css';
import './dashboard.css';
import './studio.css';
import './desktop-shell.js';
import { renderDashboard, renderProfile, renderActivity, renderPractice, renderExamAssessment } from './dashboard.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { renderDataSettings, renderChatGPTPanel, renderSyncPanel, renderUpdatePanel, renderModelPicker, renderModelOptions } from './settings-panels.js';
import { version as desktopVersion } from '../package.json';
import { checkWindowsRelease, releasesPage } from './update.js';
const deviceBridge = registerPlugin('StudyDevice');
const native = Capacitor.isNativePlatform();
const windowsDesktop = window.desktopShell?.customTitleBar === true;
const supportsAppUpdate = native || windowsDesktop;
document.documentElement.classList.toggle('native-app', native);
if (native) document.querySelector('meta[name="viewport"]').content += ', maximum-scale=1.0, user-scalable=no';
const defaultProvider = native ? 'openai' : 'codex';
let captchaSiteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY || '';
let nativeClient;

import { icon, skillIcon, modeName } from './icons.js';
import { renderLearningChat, discussionTarget, isDiscussing } from './chat.js';
import { createListeningPlayer } from './listening-player.js';

const app = document.querySelector('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const presets = [
  ['四六级', '四级', 'CET-4 / CET-6', '循序补齐考试需要的英语能力', 'violet', 'Aa'],
  ['高中英语', '高中英语', 'HIGH SCHOOL', '读懂长句，学会准确地表达', 'orange', '¶'],
  ['初中英语', '初中英语', 'MIDDLE SCHOOL', '从基础词汇和句型开始', 'blue', 'ab'],
  ['日常英语', '日常英语', 'EVERYDAY ENGLISH', '听懂、开口，在生活里用起来', 'green', 'Hi'],
];
let data = null, goal = localStorage.getItem('lsc-goal-v1') || '';
let screen = goal ? 'home' : 'welcome';
let busy = '', error = '', notice = '', settingsDraft = null, summaryId = null, draft = {};
let settingsSection = 'model';
let detailSession = null, reviewData = null, reviewOffset = 0;
let reviewFilter = 'all';
let activityData = null, practiceMode = '听力';
let wordQuery = '', wordFilter = 'learning', examGoal = '四级', examRequestId = null;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let pendingChat = null, chatScrollToEnd = true, starting = null;
let authStatus = null, authModels = [], authURL = '', authLoading = false, authPoll = null;
let importBackup = null, importPreview = null;
let syncStatus=null,syncPreview=null,syncRunning=false;
let syncError='';
let captchaToken='',captchaScriptPromise=null;
let updateState={status:'idle',error:'',data:null};
const syncFields={email:'',code:''};
let planWelcome = false, demoAnswer = '';
let codexStatus = null, codexLoading = false, codexError = '', codexPolling = null;
const emptyCatalog = () => ({models:null,loading:false,error:'',query:'',manual:false,truncated:false});
let modelCatalog = emptyCatalog(), modelGeneration = 0, modelTimer;
try { draft = JSON.parse(sessionStorage.getItem('lsc-answer-v1') || '{}'); } catch { /* Replace invalid tab draft. */ }
const draftStore=createDraftStore(localStorage);
if(draft.taskId){const saved=draftStore.read(draft.taskId);if(saved?.savedAt>(draft.savedAt || 0))draft=saved;}
let draftWarning='';
let lastActivity = Date.now(), recognition = null, audioState = 'idle', voiceMessage = '', speed = 1;
const current = () => data?.sessions.find(x => !x.finishedAt);
function draftStatusHTML(){
  const variants=draftStore.conflicts(draft.taskId);
  return `${esc(draftWarning)}${draftStore.lastResult.kind==='conflict' ? `<div>${button('采用已保存版本','draft-use-saved','secondary-button')}${button('保存当前版本','draft-keep-mine','secondary-button')}</div>`:''}${variants.length ? `<details><summary>查看其他版本草稿（${variants.length}）</summary>${variants.map((value,index)=>`<div><pre>${esc(value.answer)}</pre>${value.coachMessage ? `<p>${esc(value.coachMessage)}</p>`:''}${button('恢复这个版本','draft-restore-version','secondary-button',`data-index="${index}"`)}</div>`).join('')}</details>`:''}`;
}
function paintDraftStatus(){
  const status=app.querySelector('#draft-save-status');
  if(status){status.innerHTML=draftStatusHTML();status.style.display=draftWarning || draftStore.conflicts(draft.taskId).length ? '' : 'none';}
}
const persistDraft = (force=false) => {
  const task = current()?.current;
  if(task && task.id===draft.taskId)draft.questionCount=taskQuestions(task).length;
  const saved=draftStore.write(draft,{force});
  if(saved && draftStore.lastResult.draft){
    Object.assign(draft,draftStore.lastResult.draft);
    let values;try{values=JSON.parse(draft.answer);}catch{values=[];}
    for(const field of app.querySelectorAll('.task-text-answer')){const value=values?.[Number(field.dataset.questionIndex)] || '';if(field.value!==value)field.value=value;}
    for(const [id,key] of [['answer-text','answer'],['coach-message','coachMessage']]){const field=app.querySelector('#'+id);if(field && field.value!==(draft[key] || ''))field.value=draft[key] || '';}
  }
  let tabSaved=true;try{sessionStorage.setItem('lsc-answer-v1',JSON.stringify(draft));}catch{tabSaved=false;}
  draftWarning=draftStore.lastResult.kind==='conflict' ? '另一标签页也修改了同一处。两个版本都已保留，请选择要继续的版本。' : saved ? draftStore.lastResult.kind==='merged' ? '已合并另一标签页在其他答题格的修改。' : '' : tabSaved ? '草稿目前仅保留在此标签页，关闭前请提交或结束本轮。' : '草稿暂未写入浏览器，请保留当前页面并先复制你的回答。';
  paintDraftStatus();
};
const taskQuestions = task => task?.questions?.length ? task.questions : [{ prompt: task?.prompt || '', options: task?.options || [], answer: task?.answer || '' }];
function clearSkip(index){
  draft.skippedQuestions=(draft.skippedQuestions || []).filter(i=>i!==index);
  const control=app.querySelector(`[data-action="skip-question"][data-question-index="${index}"]`);
  if(control){control.textContent=taskQuestions(current()?.current).length>1 ? '这问不会':'这题不会';control.setAttribute('aria-pressed','false');control.parentElement.querySelector('.skip-note')?.remove();}
}
function answerComplete(task, value) {
  const items = taskQuestions(task);
  if (items.length === 1) return !!String(value || '').trim() || !!draft.skippedQuestions?.includes(0);
  try {
    const values = JSON.parse(value || '[]');
    return Array.isArray(values) && values.length === items.length && values.every((answer, i) => typeof answer === 'string' && (draft.skippedQuestions?.includes(i) || !!answer.trim() && (!items[i].options.length || items[i].options.includes(answer))));
  } catch { return false; }
}
const listeningPlayer = createListeningPlayer({
  synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance,
  onState: state => { audioState = state; if (screen === 'session' && data) render(); },
  onStarted: () => { draft.replays = (draft.replays || 0) + 1; persistDraft(); lastActivity = Date.now(); },
  onError: message => { error = message; render(); },
});
function syncDraft() {
  const task = current()?.current;
  if (task && task.id !== draft.taskId) {
    draftStore.remove(draft.taskId);
    const restored=draftStore.read(task.id);
    draft = restored || { taskId: task.id, answer: '', activeSeconds: 0, hintUsed: false, replays: 0, transcriptViewed: false, coachMessage: '', composerMode: 'answer', discussTaskId: task.id };
    if(restored && !current().feedback)notice='已恢复这道题的本机草稿，尚未提交。';
    chatScrollToEnd = true;
    if (current().feedback) {
      const saved = current().history.at(-1);
      for (const key of ['answer', 'activeSeconds', 'hintUsed', 'replays', 'transcriptViewed']) draft[key] = saved[key];
    }
    audioState = 'idle'; voiceMessage = ''; persistDraft();
  }
}
const button = (label, action, cls = 'primary-button', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${busy ? 'disabled' : ''} ${attrs}>${label}</button>`;
const duration = value => { const sec=Math.max(0,Math.round(Number(value) || 0)); return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`; };
const levelLabel = value => String(value || '待积累').replace(/\b(A1|A2|B1|B2|C1|C2)\b/, code => code + ' · ' + ({ A1: '入门', A2: '基础交流', B1: '中级', B2: '中高级', C1: '高级', C2: '精通' })[code]);
const date = value => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
async function api(path, body) {
  const result = await request(path, body);
  data = result; syncDraft();
}
async function request(path, body) {
  if (native) {
    nativeClient ||= import('./native-client.js').then(m => m.createNativeClient({ compact: true, timeZone })).catch(e => { nativeClient = null; throw e; });
    return (await nativeClient).request(path, body);
  }
  // Browser network and parse errors ("Failed to fetch", "Unexpected token <") are
  // not meaningful to learners; every caller shows request errors directly.
  let res, result;
  try {
    res = await fetch(`/api/${path}${path.includes('?') ? '&' : '?'}compact=1&tz=${encodeURIComponent(timeZone)}`, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Request': '1' }, body: JSON.stringify(body),
    });
  } catch { throw new Error('无法连接本地学习服务。请确认应用仍在运行（开发模式下确认 npm run dev 未退出）后重试。'); }
  try { result = await res.json(); }
  catch { throw new Error(res.ok ? '本地学习服务返回了无法识别的内容，请重试。' : `本地学习服务暂时不可用（HTTP ${res.status}），请稍后重试。`); }
  if (!res.ok) throw new Error(result?.error || '本地服务暂时不可用。');
  return result;
}
function sameSavedSource(cfg) {
  return cfg?.provider === data?.config?.provider && String(cfg.baseURL || '').trim().replace(/\/+$/, '') === data.config.baseURL;
}
function resetModelCatalog() {
  modelGeneration++; clearTimeout(modelTimer); modelCatalog = emptyCatalog();
}
function paintModelPicker() {
  const panel = app.querySelector('#model-picker');
  if (panel && screen === 'settings') panel.outerHTML = renderModelPicker({catalog:modelCatalog,cfg:settingsDraft,busy,esc,button});
}
async function fetchModels() {
  clearTimeout(modelTimer);
  if (modelCatalog.loading || !settingsDraft || ['codex','chatgpt'].includes(settingsDraft.provider)) return;
  const generation = ++modelGeneration, input = {...settingsDraft};
  modelCatalog.loading = true; modelCatalog.error = ''; paintModelPicker();
  try {
    const result = await request('settings/models', input);
    if (generation !== modelGeneration || screen !== 'settings') return;
    modelCatalog.models = result.models; modelCatalog.truncated = result.truncated;
  } catch (e) {
    if (generation !== modelGeneration || screen !== 'settings') return;
    modelCatalog.error = e.message;
  } finally {
    if (generation === modelGeneration) { modelCatalog.loading = false; paintModelPicker(); }
  }
}
function autoFetchModels(delay = 250) {
  clearTimeout(modelTimer);
  const cfg = settingsDraft;
  if (!cfg || ['codex','chatgpt'].includes(cfg.provider) || (!cfg.apiKey?.trim() && !(sameSavedSource(cfg) && data.config.hasKey))) return;
  try { const url = new URL(cfg.baseURL); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !native && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) return; } catch {return;}
  modelTimer = setTimeout(fetchModels, delay);
}
async function refreshCodex() {
  if (codexLoading) return;
  codexLoading = true; codexError = ''; render();
  try { codexStatus = await request('codex/status'); }
  catch (e) { codexError = e.message; }
  finally {
    codexLoading = false;
    clearTimeout(codexPolling);
    if (screen === 'settings' && settingsDraft?.provider === 'codex' && codexStatus?.login?.state === 'pending' && !codexError) codexPolling = setTimeout(refreshCodex, 3000);
    if (screen === 'settings') render();
  }
}
async function refreshAuth() {
  if(authLoading) return;
  authLoading=true; render();
  try {
    authStatus=await request('chatgpt/status');
    if(authStatus.loginError) error=authStatus.loginError;
    if(authStatus.loggedIn) {authURL='';planWelcome=!localStorage.getItem(`lsc-plan-notice-${authStatus.activeId}`);authModels=(await request('chatgpt/models')).models;}
    else if(!authStatus.login) authURL='';
  } catch(e) {error=e.message;}
  finally {
    authLoading=false;clearTimeout(authPoll);
    if(screen==='settings' && settingsDraft?.provider==='chatgpt' && authStatus?.login?.state==='pending') authPoll=setTimeout(refreshAuth,3000);
    if(screen==='settings') render();
  }
}
function syncPanel() { return renderSyncPanel({status:syncStatus,fields:syncFields,preview:syncPreview,error:syncError,activity:/同步|验证码|邮箱/.test(busy)?busy:'',esc,button,captchaSiteKey,captchaToken}); }
function updatePanel() {
  return renderUpdatePanel({
    state:updateState, platform:windowsDesktop ? 'Windows' : 'iOS',
    currentVersion:windowsDesktop ? desktopVersion : '', releasesPage, esc, button,
  });
}
function paintSync() {
  const panel=app.querySelector('#sync-panel');
  if(panel && !panel.contains(document.activeElement) && !busy) { panel.outerHTML=syncPanel(); ensureCaptchaWidget(); }
}
async function refreshSync() {
  try {syncStatus=await request('sync/status');if(!captchaSiteKey && syncStatus.turnstileSiteKey) captchaSiteKey=syncStatus.turnstileSiteKey;paintSync();} catch(e) {if(screen==='settings'){error=e.message;render();}}
}
function ensureCaptchaWidget() {
  if (!captchaSiteKey || screen !== 'settings' || settingsSection !== 'sync') return;
  const mount=app.querySelector('#sync-captcha'); if(!mount || mount.dataset.rendered==='1') return;
  const renderWidget=()=>{ if(!window.turnstile || !app.contains(mount)) return; mount.dataset.rendered='1'; window.turnstile.render(mount,{sitekey:captchaSiteKey,appearance:'interaction-only',callback:token=>{captchaToken=String(token||'');const send=app.querySelector('[data-action="sync-code"]');if(send)send.disabled=!captchaToken;},'expired-callback':()=>{captchaToken='';const send=app.querySelector('[data-action="sync-code"]');if(send)send.disabled=true;},'error-callback':()=>{captchaToken='';}}); };
  if(window.turnstile) return renderWidget();
  captchaScriptPromise ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});
  captchaScriptPromise.then(renderWidget).catch(()=>{});
}
async function checkAppUpdate() {
  if (!supportsAppUpdate || updateState.status === 'loading') return;
  updateState={status:'loading',error:'',data:null}; render();
  try {
    const result = windowsDesktop ? await checkWindowsRelease({currentVersion:desktopVersion}) : await request('app/update');
    updateState={status:'ready',error:'',data:result};
  }
  catch(e) { updateState={status:'error',error:e.message,data:null}; }
  render();
}
async function syncAction(name,input={}) {
  if(syncRunning && !['disable','logout'].includes(name)) throw new Error('同步正在进行，请稍后重试。');
  syncRunning=true;
  syncError='';
  try {
    const result=await request(`sync/${name}`,input);
    syncStatus=result.status;syncPreview=result.preview || null;
    if(result.state) {data=result.state;syncDraft();}
    return result;
  } catch(e) {syncError=e.message;throw e;} finally {syncRunning=false;}
}
async function automaticSync() {
  if(busy || syncRunning || document.hidden || navigator.onLine===false) return;
  syncRunning=true;
  const before=data;
  try {
    syncStatus=await request('sync/status');
    if(syncStatus.enabled) {
      const result=await request('sync/run',{});syncStatus=result.status;
      if(!busy && before===data && result.state) {data=result.state;syncDraft();if(['home','welcome','profile','wordbook','exam'].includes(screen))render();}
    }
    paintSync();
  } catch { /* Local practice continues; the next foreground/online event retries. */ }
  finally {syncRunning=false;}
}
async function previewBackup(value) {
  if(value.length>20*1024*1024) throw new Error('备份超过 20 MB，请选择较小的备份文件。');
  let backup;try{backup=JSON.parse(value);}catch{throw new Error('文件不是有效的 JSON 备份。');}
  importPreview=await request('data/preview',{backup});importBackup=backup;
}
async function exportData() {
  const backup=await request('data/export'),value=JSON.stringify(backup,null,2);
  if(native) {const result=await deviceBridge.exportFile({value});notice=result.completed?'备份已交给系统保存或分享。':'已取消导出。';return;}
  const url=URL.createObjectURL(new Blob([value],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`language-study-coach-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice='备份已开始下载。';
}
async function run(label, fn) {
  if (busy) return;
  busy = label; error = ''; notice = ''; stopMedia(); render();
  try { await fn(); } catch (e) { error = e.message === 'Failed to fetch' ? (native ? '无法连接模型服务，请检查网络后重试。' : '无法连接本地服务，请确认 npm run dev 正在运行，再重试。') : e.message; }
  finally {
    busy = ''; pendingChat = null; lastActivity = Date.now(); render();
    if (error && screen === 'settings') window.setTimeout(() => app.querySelector(syncError ? '#sync-error' : '.alert.error')?.scrollIntoView({ block:'center', inline:'nearest', behavior:'auto' }), 0);
  }
}
function navigate(target) {
  stopMedia(); error = ''; notice = ''; screen = target;
  clearTimeout(codexPolling); clearTimeout(authPoll);
  if (target !== 'summary') detailSession = null;
  if (target !== 'review') { reviewData = null; reviewOffset = 0; }
  if (!['activity','week'].includes(target)) activityData = null;
  resetModelCatalog();
  if (target !== 'settings') { settingsDraft = null; codexStatus = null; authURL = ''; importBackup = null; importPreview = null; }
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (target === 'activity' || target === 'week') {
    activityData = null;
    return run('正在读取学习记录…', async () => { activityData = await request('activity?offset=0'); });
  }
  if (target === 'review') {
    reviewOffset = 0; reviewData = null;
    window.scrollTo({ top: 0, behavior: 'instant' });
    return run('正在读取错题…', async () => { reviewData = await request(`review?goal=${encodeURIComponent(goal)}&offset=0&filter=${reviewFilter}`); });
  }
  if (target === 'wordbook') { render(); return fillWordMeanings(); }
  if (target === 'profile') {
    return run('正在读取能力详情…', async () => { const profile = await request('profile'); data = { ...data, ...profile }; });
  }
  clearTimeout(codexPolling); clearTimeout(authPoll);
  if (target === 'settings') {
    settingsSection = 'model';
    settingsDraft = { ...(data?.config || { provider: defaultProvider, baseURL: native ? 'https://api.openai.com/v1' : '', model: '' }), apiKey: '' };
    if (settingsDraft.provider === 'codex') refreshCodex();
    if (settingsDraft.provider === 'chatgpt') refreshAuth();
    refreshSync();
  }
  render(); if (target === 'settings') autoFetchModels(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function fillWordMeanings(word) {
  const words=word ? [word] : (data.wordbook || []).filter(item=>!item.meaning).slice(0,8).map(item=>item.word);
  if(!data.configured || !words.length || busy)return;
  await run('正在生成中文释义，生词已保存…',()=>api('vocabulary/define',{words}));
}
function selectGoal(value) { goal = value; localStorage.setItem('lsc-goal-v1', goal); navigate('home'); }
function render() {
  document.documentElement.classList.toggle('is-practicing', screen === 'session');
  const navScreen = ['activity','week','summary','practice','exam','session','starting'].includes(screen) ? 'home' : screen;
  const previousLog = app.querySelector('#chat-log');
  const previousScroll = previousLog?.scrollTop || 0;
  const nearEnd = !previousLog || previousLog.scrollHeight - previousScroll - previousLog.clientHeight < 100;
  const routeLabel = {home:'学习概览',welcome:'选择学习目标',profile:'能力进展',review:'错题回顾',wordbook:'单词本',settings:'设置',activity:'学习记录',week:'近 7 天',summary:'练习回顾',practice:`${practiceMode}练习`,exam:`${examGoal}通过率`}[screen];
  app.innerHTML = `<div class="shell ${screen === 'session' ? 'session-shell' : ''}"><header class="topbar">
    <button class="studio-brand" data-action="home" aria-label="Language Study Coach 首页"><span class="studio-mark">${icon('read')}</span><span>Language<span>STUDY COACH</span></span></button>
    <span class="nav-caption">你的学习空间</span>
    <nav class="topnav" aria-label="主导航">${[['home','学习'],['profile','进展'],['review','错题'],['wordbook','单词本'],['settings','设置']].map(([key, label]) => button(icon({home:'mixed',profile:'target',review:'history',wordbook:'words',settings:'settings'}[key]) + `<span>${label}</span><span class="nav-indicator" aria-hidden="true"></span>`, key, `nav-link ${navScreen === key ? 'active' : ''}`, navScreen === key ? 'aria-current="page"' : '')).join('')}</nav>

    <div class="sidebar-status"><i class="${data?.configured ? 'connected' : ''}"></i>${data?.configured ? '学习模型已配置' : '等待连接学习模型'}</div>
    </header><main class="main-content ${screen === 'session' ? 'chat-main' : ''}">
      ${routeLabel && !['home','welcome'].includes(screen) ? `<div class="workspace-line"><nav class="breadcrumbs" aria-label="页面路径">${button('学习空间','home','breadcrumb-link')}<span aria-hidden="true">/</span><span aria-current="page">${esc(routeLabel)}</span></nav></div>` : ''}
      ${error ? `<div class="alert error" role="alert">${esc(error)} ${button('关闭', 'dismiss', 'text-button')}</div>` : ''}
      ${notice ? `<div class="alert success" role="status">${esc(notice)}</div>` : ''}
      ${screen==='session' && !current()?.feedback ? `<div id="draft-save-status" class="alert error" role="alert" style="${draftWarning || draftStore.conflicts(draft.taskId).length ? '' : 'display:none'}">${draftStatusHTML()}</div>` : ''}
      ${busy && screen !== 'session' && screen !== 'starting' ? `<div class="busy-banner" role="status"><span class="spinner"></span>${esc(busy)}</div>` : ''}
      ${!data ? `<div class="empty-state"><h2>正在读取学习记录</h2><p>${native ? '学习记录保存在这台手机。' : '学习记录保存在这台电脑。'}</p>${button('重新连接', 'reload')}</div>` : page()}
    </main>${planWelcome?`<dialog class="plan-welcome" aria-modal="true" aria-label="你正在使用 ChatGPT 订阅"><h2>你正在使用 ChatGPT 订阅</h2><p>本应用中符合条件的出题、批改和追问会使用你的订阅额度。你可以在 ChatGPT 用量设置中管理限额或断开授权。</p>${button('知道了','plan-notice-close')}</dialog>`:''}</div>`;
  if(planWelcome) app.querySelector('.plan-welcome')?.showModal();
  ensureCaptchaWidget();
  const log = app.querySelector('#chat-log');
  if (log) {
    // The first prompt should start at its top. Later turns stay anchored to the
    // newest message so the learner sees feedback and the prepared next task.
    const firstPrompt = !current()?.history?.length && !pendingChat;
    log.scrollTop = firstPrompt && !previousLog ? 0 : (chatScrollToEnd || nearEnd ? log.scrollHeight : previousScroll);
    chatScrollToEnd = false;
  }
}
function page() {
  if (screen === 'wordbook') return renderWordbook({data,esc,button,query:wordQuery,filter:wordFilter});
  if (screen === 'exam') return renderExamAssessment({data,goal:examGoal,esc,button});
  if (screen === 'settings') return settings();
  if (screen === 'profile') return renderProfile({ data, goal, esc, button });
  if (screen === 'activity' || screen === 'week') return renderActivity({ data, activity: activityData, week: screen === 'week', esc, button, date, duration });
  if (screen === 'practice') return renderPractice({ data, goal, mode: practiceMode, esc, button });
  if (screen === 'welcome' || !goal) return welcome();
  if (screen === 'starting') return startingPage();
  if (screen === 'session') return sessionPage();
  if (screen === 'summary') return summaryPage();
  if (screen === 'review') return reviewPage();
  return home();
}
function welcome() {
  const learned = data.totals?.all?.count || 0;
  return `<section class="welcome-page"><div class="welcome-copy"><span class="eyebrow">${learned ? `已完成 ${learned} 道练习` : 'YOUR ENGLISH COACH'}</span><h1>${learned ? '继续你的<br><em>英语练习。</em>' : '今天，<br><em>练一点英语。</em>'}</h1><p>${learned && data.profile?.summary ? esc(data.profile.summary.length > 200 ? data.profile.summary.slice(0,200) + '…' : data.profile.summary) : '选择学习目标，从一轮练习开始。'}</p><div class="welcome-note">${learned ? '选择接下来想练的目标。' : '阅读、听力、表达，按你的节奏来。'}</div></div>
    <div class="preset-panel"><div class="panel-heading">你想从哪里开始？<span class="muted">随时可以更换</span></div><div class="preset-grid">${presets.map(([name, value, tag, detail, color, icon]) => `<button class="preset-card ${color}" data-action="goal" data-value="${value}" ${busy ? 'disabled' : ''}><span class="card-arrow">↗</span><span class="preset-icon">${icon}</span><span class="preset-text"><span class="preset-eyebrow">${tag}</span><strong>${name}</strong><span>${detail}</span></span></button>`).join('')}</div><div class="panel-footer">四个学习目标 · 一个会逐步了解你的教练</div></div></section>`;
}
function home() { return renderDashboard({ data, goal, esc, button, date, demoAnswer }); }
function showSettingsSection(section) {
  if (!['model','sync','data','update'].includes(section)) return;
  settingsSection = section;
  for (const tab of app.querySelectorAll('[data-action="settings-section"]')) {
    const selected = tab.dataset.section === section;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of app.querySelectorAll('[data-settings-panel]')) panel.hidden = panel.dataset.settingsPanel !== section;
  if (section === 'sync') ensureCaptchaWidget();
}
function settings() {
  const cfg = settingsDraft || { provider: defaultProvider, baseURL: native ? 'https://api.openai.com/v1' : '', model: '', apiKey: '' };
  const tabs = [['model','模型连接','settings'],['sync','云端同步','refresh'],['data','学习数据','read'],...(supportsAppUpdate ? [['update','应用更新','history']] : [])];
  const panelAttrs = key => `id="settings-${key}-panel" data-settings-panel="${key}" role="tabpanel" aria-labelledby="settings-${key}-tab" ${settingsSection !== key ? 'hidden' : ''}`;
  return `<section class="settings-page"><h1>设置</h1><p class="lead">管理模型连接、云端同步与学习数据。</p><nav class="section-tabs" role="tablist" aria-label="设置分类">${tabs.map(([key,label,symbol])=>button(`${icon(symbol)}<span>${label}</span>`,'settings-section','section-tab',`data-section="${key}" id="settings-${key}-tab" role="tab" aria-selected="${settingsSection===key}" aria-controls="settings-${key}-panel" tabindex="${settingsSection===key?0:-1}"`)).join('')}</nav><div ${panelAttrs('model')}><div class="settings-grid"><form id="settings-form" class="card-surface settings-form"><div class="form-section-heading"><span class="form-section-icon">${icon('settings')}</span><div><h2>模型连接</h2><p>让熟悉的 AI，成为你的英语教练。</p></div></div>
    <label>服务商<select name="provider" ${busy ? 'disabled' : ''}>${Object.entries(data.providers).map(([key, p]) => `<option value="${key}" ${cfg.provider === key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
    ${cfg.provider === 'chatgpt' ? renderChatGPTPanel({status:authStatus,loading:authLoading,models:authModels,authURL,cfg,esc,button}) : cfg.provider === 'codex' ? codexPanel(cfg) : `<label>API 地址<input name="baseURL" type="url" required value="${esc(cfg.baseURL)}" placeholder="https://your-provider.example/v1" ${busy ? 'disabled' : ''}></label><p class="field-help">填写基础地址，通常以 /v1 结尾；不包含 /chat/completions。</p>
    <label>API Key<input name="apiKey" type="password" autocomplete="off" value="${esc(cfg.apiKey)}" placeholder="${sameSavedSource(cfg) && data.config?.hasKey ? '已保存；留空可继续使用' : '粘贴你的 API Key'}" ${busy ? 'disabled' : ''}></label>
    ${renderModelPicker({catalog:modelCatalog,cfg,busy,esc,button})}
    <div class="form-actions"><button type="submit" class="primary-button" ${busy ? 'disabled' : ''}>保存配置</button>${button('测试已保存的连接', 'test-connection', 'secondary-button', data.configured ? '' : 'disabled')}</div>`}</form>
    <aside class="settings-note"><span class="note-symbol">✦</span><h2>${cfg.provider === 'chatgpt' ? '使用 ChatGPT 订阅，<br>开始学英语。' : cfg.provider === 'codex' ? '用已经熟悉的 Codex，<br>开始学英语。' : '一个接口，完整学习流程。'}</h2>${cfg.provider === 'chatgpt' ? '<p>在系统浏览器的官方页面授权。登录身份会经过校验，账号凭据单独保存在当前设备。</p><p>出题、批改和追问会使用你的订阅额度。可以在 ChatGPT 设置中管理或撤销本应用的授权。</p>' : cfg.provider === 'codex' ? '<p>复用这台电脑上 Codex 的登录状态，无需填写 API Key。未登录时，在官方页面完成 ChatGPT 授权即可。</p><p>授权凭据由 Codex 管理，学习软件不复制令牌。新授权会用于这台电脑共享的 Codex 登录。</p><p>出题与批改使用你的 Codex 账户额度。学习内容会发给 OpenAI；此接入用于本地个人版。</p>' : '<p>AI 负责出题、批改、解释和安排下一题。兼容接口可用于供应商提供的 OpenAI 兼容服务。</p><p>密钥与学习记录保存在当前设备，学习内容只发送给你选择的模型服务商。</p><p>学习内容会发送给所选供应商，按其 API 用量计费。</p>'}<p>${native ? '听力使用系统英语语音。语音输入使用 iPhone 键盘听写，确认文字后再提交。' : '听力使用系统英语语音。浏览器语音输入转成文字后可编辑再提交，可能使用浏览器厂商的语音服务。'}</p></aside></div></div><div ${panelAttrs('sync')}>${syncPanel()}</div><div ${panelAttrs('data')}>${renderDataSettings({preview:importPreview,esc,button})}</div>${supportsAppUpdate?`<div ${panelAttrs('update')}>${updatePanel()}</div>`:''}</section>`;
}
function codexPanel(cfg) {
  const status = codexStatus, login = status?.login;
  const models = status?.models || [];
  return `<div class="codex-account" aria-live="polite"><span class="codex-mark">C</span><div><strong>${codexLoading ? '正在检测本机 Codex…' : status?.loggedIn ? esc(status.account.label) : '连接你的 Codex'}</strong><p>${status?.loggedIn ? esc([status.account.email, status.account.plan].filter(Boolean).join(' · ')) : '在官方页面授权，登录完成后回到这里。'}</p></div></div>
    ${codexError ? `<p class="codex-error" role="alert">${esc(codexError)}</p>` : ''}
    ${status?.loggedIn ? `<label>学习模型<select name="model" ${busy ? 'disabled' : ''}><option value="">Codex 默认模型</option>${cfg.model && !models.some(m => m.id === cfg.model) ? `<option selected value="${esc(cfg.model)}">${esc(cfg.model)}</option>` : ''}${models.map(m => `<option value="${esc(m.id)}" ${cfg.model === m.id ? 'selected' : ''}>${esc(m.name)}${m.isDefault ? ' · 推荐' : ''}</option>`).join('')}</select></label><p class="field-help">${esc(status.modelError || '模型列表来自本机 Codex，实际可用性以连接测试为准。')}</p><div class="form-actions"><button type="submit" class="primary-button" ${busy ? 'disabled' : ''}>使用这个 Codex</button>${button('测试已保存的连接', 'test-connection', 'secondary-button', data.config?.provider === 'codex' ? '' : 'disabled')}</div>` : login?.state === 'pending' ? `<div class="codex-login"><strong>等待你在官方页面完成授权</strong>${login.userCode ? `<p>设备授权码</p><code class="device-code">${esc(login.userCode)}</code>` : ''}<a class="primary-button" href="${esc(login.url)}" target="_blank" rel="noopener noreferrer">前往官方页面授权 ↗</a><p class="field-help">完成后会自动刷新。若链接失效，可取消后重新发起。</p>${button('取消本次授权', 'codex-cancel', 'text-button')}</div>` : `<div class="form-actions">${button('ChatGPT 授权登录', 'codex-login', 'primary-button', codexLoading || !status?.installed ? 'disabled' : '')}${button('使用设备码登录', 'codex-device', 'secondary-button', codexLoading || !status?.installed ? 'disabled' : '')}</div>`}
    ${login?.message ? `<p class="field-help" role="status">${esc(login.message)}</p>` : ''}
    ${button('重新检测登录状态', 'codex-refresh', 'text-button', codexLoading ? 'disabled' : '')}<p class="field-help">仅切换学习软件中的服务商，不会退出本机 Codex。</p>`;
}
function startingPage() {
  return `<section class="starting-page" aria-busy="${!!busy}"><span class="mode-symbol">${icon('mixed')}</span><span class="eyebrow">${esc(goal)} · ${starting?.placement ? '历史练习' : esc(modeName(starting?.mode || '综合')) + '练习'}</span><h1 tabindex="-1" id="starting-title">${busy ? '正在准备第一题' : '暂时没能准备好题目'}</h1><div class="starting-message" role="status">${busy ? '<span class="spinner"></span><span>教练正在结合你的水平安排练习…</span>' : '<span>请检查网络或模型配置，然后重试。</span>'}</div><p>${busy ? '第一题准备好后会自动进入。无需重复点击。' : '已保存的学习记录不受影响。'}</p>${!busy ? button('重新准备', 'start-again') + button('返回学习页', 'home', 'secondary-button') : ''}</section>`;
}
function sessionPage() {
  return renderLearningChat({ session: current(), draft, busy, pendingChat, esc, button, audioState, voiceMessage, speed, recognition, usesChatGPT:data.config?.provider==='chatgpt' });
}
function summaryPage() {
  const s = detailSession;
  if (!s) return '<div class="empty-state">正在读取练习记录…</div>';
  const report = s.report, score = roundCounts(s.history);
  const warning = s.reportError ? `<div class="summary-warning" role="alert"><strong>本轮作答已保存。</strong><p>${esc(s.reportError)}</p></div>` : '';
  return `<section class="summary-page"><span class="summary-icon">✓</span><span class="eyebrow">ONE STEP FURTHER</span><h1>${esc(s.goal)} · <em>${esc(modeName(s.mode))}小结</em></h1><p class="fine-print">${esc(new Date(s.finishedAt || s.startedAt).toLocaleDateString('zh-CN'))} · 完成 ${score.count} 题</p><p>${esc(report?.summary || (s.history.length ? '本轮作答已保存，学习小结暂未生成。' : '本轮没有提交答案。'))}</p>${warning}${!report && s.finishedAt && s.history.length ? `<div class="form-actions">${button('补生成本轮小结','recover-report','secondary-button',`data-id="${esc(s.id)}"`)}</div>` : ''}${report?.generatedAt ? `<p class="fine-print">小结更新于 ${esc(new Date(report.generatedAt).toLocaleString('zh-CN'))}</p>` : ''}<div class="summary-grid"><div><span>完成</span><strong>${score.count}<small> 题</small></strong></div><div><span>回答正确</span><strong>${score.correct}<small> 题</small></strong></div><div><span>有效作答</span><strong class="summary-time">${duration(s.history.reduce((n, x) => n + (x.activeSeconds || 0), 0))}</strong></div></div>${report ? `<div class="summary-focus"><span class="spark">✦</span><div><strong>下一步，试试这个方向</strong><p>${esc(report.nextFocus)}</p>${button('按这个建议继续练 →', 'start-recommended', 'secondary-button', `data-id="${esc(s.id)}" data-goal="${esc(s.goal)}" ${current() ? 'disabled' : ''}`)}</div></div><p class="fine-print">本轮能力 · ${esc(report.level)}</p>${button('重新整理本轮小结','recover-report','text-button',`data-id="${esc(s.id)}" data-regenerate="true"`)}` : ''}${roundReview(s)}${unfinishedReview(s)}<div class="form-actions">${button('回到学习页', 'home')}${button('回顾错题', 'review', 'secondary-button')}</div></section>`;
}
function unfinishedReview(session) {
  const pending = session.unfinished;
  if (!pending) return '';
  return `<section class="dash-panel unfinished-review"><h2>未提交的草稿 · 未计分</h2><p>结束本轮时保留，未加入题数、时长或能力判断。</p><p class="chat-text">${esc(pending.task.prompt)}</p>${taskQuestions(pending.task).map((q,i)=>`<p>${taskQuestions(pending.task).length>1 ? i+1+'. ' : ''}${esc(q.prompt)}</p>`).join('')}<pre class="chat-text">${esc((()=>{try{const values=JSON.parse(pending.answer);return Array.isArray(values) ? values.map((value,i)=>`${i+1}. ${value || '（未填写）'}`).join('\n') : pending.answer;}catch{return pending.answer || '（未填写）';}})())}</pre>${(session.discussions?.[pending.task.id] || []).map(turn=>`<p class="chat-text"><strong>你</strong> ${esc(turn.message)}</p><p class="chat-text"><strong>教练</strong> ${esc(turn.reply)}</p>`).join('')}</section>`;
}
function roundReview(session) {
  if (!session.history.length) return '';
  return `<section class="round-review" aria-label="本轮逐题回顾"><div class="section-title"><h2>本轮逐题回顾</h2><span class="muted">展开看回答与解析</span></div>${session.history.map((entry, index) => {
    const task = entry.task, feedback = entry.feedback;
    const helpers = [entry.hintUsed && '使用了提示', entry.replays > 0 && `播放听力 ${entry.replays} 次`, entry.transcriptViewed && '查看了听力原文'].filter(Boolean);
    const questionReview=renderAnswerReview(entry,esc), score=roundCounts([entry]);
    return `<details class="round-question"><summary><span class="round-number">${index + 1}</span><span class="round-question-title"><strong>${esc(task.skill)} · ${esc(task.level)}</strong><span>${esc(task.prompt)}</span></span><span class="round-result ${feedback.correct ? 'right' : 'wrong'}">${score.count>1 ? `${score.correct} / ${score.count} 小题` : feedback.correct ? '答对' : '再巩固'}</span></summary><div class="round-answer">
      ${task.passage ? `<div class="reading-passage" lang="en">${esc(task.passage)}</div>${task.translation ? `<div class="reading-translation" lang="zh-CN"><span>中文译文</span><p>${esc(task.translation)}</p></div>` : ''}` : ''}${task.audio ? `<div class="round-material"><strong>听力原文</strong><p lang="en">${esc(task.audio)}</p></div>` : ''}
      ${questionReview}
      <div class="round-explanation"><strong>理解这道题</strong><p>${esc(feedback.explanation)}</p>${feedback.suggestion ? `<p><strong>表达建议</strong><br>${esc(feedback.suggestion)}</p>` : ''}</div>
      ${(session.discussions?.[task.id] || []).length ? `<details class="saved-discussion"><summary>查看这道题的追问记录</summary>${session.discussions[task.id].map(turn => `<div><strong>你</strong><p class="chat-text">${esc(turn.message)}</p><strong>英语教练</strong><p class="chat-text">${esc(turn.reply)}</p></div>`).join('')}</details>` : ''}
      <p class="field-help">作答 ${duration(entry.activeSeconds)}${helpers.length ? ` · ${helpers.join(' · ')}` : ''}</p>
    </div></details>`;
  }).join('')}</section>`;
}
function reviewPage() {
  if (!reviewData) return '<div class="empty-state">正在读取错题…</div>';
  const mistakes = reviewData.items;
  return `<section class="review-page"><h1>错题回顾</h1><p class="review-lead">${esc(goal)} · ${reviewFilter === 'due' ? '到期知识点' : '历史错题'} ${reviewData.total} 项</p><div class="review-filters">${button(`到期复习 ${reviewData.dueCount || 0}`,'review-due','secondary-button',`aria-pressed="${reviewFilter==='due'}"`)}${button('全部错题','review-all','secondary-button',`aria-pressed="${reviewFilter==='all'}"`)}</div><p class="activity-note">同一知识点合并安排；跨日独立答对后延长间隔，同日重做或用提示答对不记作跨日巩固。</p><div class="review-list">${mistakes.length ? mistakes.map(m => `<article class="review-item"><div class="review-item-top"><span class="skill-tag">${m.task.skill}</span><span>${date(m.at)}</span></div><h2>${esc(m.reviewStatus?.weakness || m.feedback.weakness)}</h2>${m.reviewStatus ? `<span class="review-status">${esc(m.reviewStatus.status)} · 下次 ${esc(m.reviewStatus.dueDate)} · 跨日巩固 ${m.reviewStatus.streak}/3 次</span>` : ''}<p>${esc(m.task.prompt)}</p><details><summary>查看回答与解析</summary>${m.task.passage ? `<p>${esc(m.task.passage)}</p>` : ''}${m.task.audio ? `<p>${esc(m.task.audio)}</p>` : ''}${renderAnswerReview(m,esc)}<p>${esc(m.feedback.explanation)}</p></details>${button('换道题再练一次 →', 'retry-mistake', 'text-button', `data-id="${m.id}" ${m.reviewQuestionIndex !== undefined ? `data-question-index="${m.reviewQuestionIndex}"` : ''} ${current() ? 'disabled' : ''}`)}</article>`).join('') : `<div class="empty-state"><span>✦</span><h2>这里会留下值得再练的知识点</h2><p>${reviewFilter==='due' ? '今天没有到期复习，可以在全部错题中查看其他知识点。' : '完成练习后，答错的题目和解析会自动整理到这里。'}</p>${button('开始学习', 'home')}</div>`}</div>${reviewData.total > 20 ? `<div class="review-pagination">${button('上一页','review-prev','secondary-button', reviewOffset ? '' : 'disabled')}<span>${Math.floor(reviewOffset/20)+1} / ${Math.ceil(reviewData.total/20)}</span>${button('下一页','review-next','secondary-button', reviewData.hasMore ? '' : 'disabled')}</div>` : ''}${current() ? `<p class="help">完成当前练习后可重练错题。</p>` : ''}</section>`;
}

function stopMedia() {
  listeningPlayer.stop(false); audioState = 'idle';
  if (recognition) { recognition.onend = null; recognition.abort(); recognition = null; }
}
function playAudio(restart = false) {
  if (!restart && audioState === 'loading') { listeningPlayer.stop(); return; }
  if (!restart && audioState === 'playing') { listeningPlayer.pause(); return; }
  if (!restart && audioState === 'paused') { listeningPlayer.resume(); lastActivity = Date.now(); return; }
  stopMedia(); error = '';
  listeningPlayer.play(current()?.current?.audio, speed);
}
function voiceInput(field = 'answer', questionIndex = null) {
  if (native) {
    voiceMessage = '点击 iPhone 键盘上的麦克风听写，确认文字后再提交。'; render();
    app.querySelector(field === 'coachMessage' ? '#coach-message' : '#answer-text')?.focus(); return;
  }
  if (recognition) { recognition.stop(); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { voiceMessage = '此浏览器不支持语音转写，请用键盘输入或换用支持的浏览器。'; render(); return; }
  stopMedia();
  const taskId = current().current.id;
  const r = new SpeechRecognition(); recognition = r; r.lang = field === 'coachMessage' ? 'zh-CN' : 'en-US'; r.interimResults = false; r.continuous = false;
  r.onresult = event => {
    if (draft.taskId !== taskId || recognition !== r) return;
    const count=taskQuestions(current()?.current).length;
    const before=questionIndex === null ? draft[field] || '' : questionAnswers(draft.answer,count)[questionIndex];
    const value=`${before} ${event.results[0][0].transcript}`.trim().slice(0, field === 'coachMessage' ? 2000 : 4000);
    if(questionIndex === null)draft[field]=value;else{draft.answer=updateQuestionAnswer(draft.answer,count,questionIndex,value);clearSkip(questionIndex);}
    if (field === 'coachMessage') draft.coachRequestId = null;
    persistDraft();
    voiceMessage = '转写完成，请确认文字后提交。'; lastActivity = Date.now();
  };
  r.onerror = event => { voiceMessage = event.error === 'not-allowed' ? '未获得麦克风权限，可以继续键盘输入。' : `语音转写未完成（${event.error}），请重试或键盘输入。`; };
  r.onend = () => { if (recognition === r) { recognition = null; render(); } };
  voiceMessage = field === 'coachMessage' ? '正在听，请说出你想问的内容……' : '正在听，请用英语说话……';
  try { r.start(); } catch { recognition = null; voiceMessage = '麦克风暂时不可用，请重试。'; }
  render();
}
// Keep the mobile keyboard and caret when tapping answer tools.
app.addEventListener('pointerdown', event => {
  if (event.target.closest('[data-action="answer-newline"], [data-action="answer-next-field"]')) event.preventDefault();
});
app.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el || busy || el.disabled) return;
  const action = el.dataset.action;
  if (action === 'settings-section') { showSettingsSection(el.dataset.section); return; }
  if (action === 'draft-use-saved' || action === 'draft-restore-version') {
    const value=action === 'draft-use-saved' ? draftStore.read(draft.taskId) : draftStore.conflicts(draft.taskId)[Number(el.dataset.index)];
    if(value){draft={...value};persistDraft(true);render();}return;
  }
  if(action==='draft-keep-mine'){persistDraft(true);render();return;}
  if(action==='timer-toggle'){draft.timerPaused=!draft.timerPaused;persistDraft();render();return;}
  if(action==='skip-question'){
    const index=Number(el.dataset.questionIndex),items=taskQuestions(current()?.current),selected=new Set(draft.skippedQuestions || []);
    if(selected.has(index))selected.delete(index);else{selected.add(index);if(items.length===1)draft.answer='';else{let values;try{values=JSON.parse(draft.answer);}catch{values=[];}if(!Array.isArray(values) || values.length!==items.length)values=Array(items.length).fill('');values[index]='';draft.answer=JSON.stringify(values);}}
    draft.skippedQuestions=[...selected];persistDraft();render();return;
  }
  if (action === 'review-due' || action === 'review-all') {
    reviewFilter = action === 'review-due' ? 'due' : 'all'; return navigate('review');
  }
  if (action === 'review') reviewFilter = 'all';
  if (action === 'refresh-profile') {
    if (!data.configured) return navigate('settings');
    return run('正在整理最近的学习表现…', async () => {
      await api('profile/refresh', {});
      data = { ...data, ...await request('profile') };
      notice = '学习小结已更新。';
    });
  }
  if (action === 'recover-report') return run('正在根据本轮保存的回答补生成小结…',async()=>{
    const id=el.dataset.id;
    await api('session/report',{sessionId:id,regenerate:el.dataset.regenerate === 'true'});detailSession=await request(`session/detail?id=${encodeURIComponent(id)}`);screen='summary';
    notice='小结已更新。';
  });
  if (action === 'demo-answer') { demoAnswer = ['read','reads'].includes(el.dataset.value) ? el.dataset.value : ''; return render(); }
  if (action === 'connect-existing') return run('正在检查已有 Codex 登录…', async () => {
    const status = await request('codex/status');
    if (!status.loggedIn) { navigate('settings'); notice = '尚未检测到已登录的 Codex，可在这里授权，或选择其他服务商。'; return; }
    await api('settings', { provider: 'codex', baseURL: '', model: '' });
    await api('settings/test', {}); navigate('home'); notice = '已连接并通过测试，可以开始练习。';
  });
  if (action === 'answer-newline' || action === 'answer-next-field') {
    const field = document.getElementById(action === 'answer-newline' ? el.dataset.field : el.dataset.next);
    if (!field || field.disabled) return;
    field.focus({ preventScroll: true });
    if (action === 'answer-newline' && field.value.length - (field.selectionEnd - field.selectionStart) < field.maxLength) {
      field.setRangeText('\n', field.selectionStart, field.selectionEnd, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    keepFocusedFieldVisible(field);
    return;
  }
  if (action === 'models-refresh') return fetchModels();
  if (action === 'app-update-check') return checkAppUpdate();
  if (action === 'models-mode') {modelCatalog.manual = !modelCatalog.manual; modelCatalog.query = ''; return paintModelPicker();}
  if(action==='plan-notice-close') {if(authStatus?.activeId)localStorage.setItem(`lsc-plan-notice-${authStatus.activeId}`,'seen');planWelcome=false;return render();}
  if(action==='sync-code') return run('正在发送验证码…',async()=>{await syncAction('send-code',{email:syncFields.email || syncStatus?.email,captchaToken});notice='验证码已发送，请查看邮箱；一分钟后可重新发送。';captchaToken='';});
  if(action==='sync-cancel') {syncPreview=null;return render();}
  if(['sync-preview','sync-confirm','sync-disable','sync-logout','sync-now'].includes(action)) {
    const name={'sync-preview':'preview','sync-confirm':'enable','sync-disable':'disable','sync-logout':'logout','sync-now':'run'}[action];
    return run(action==='sync-preview'?'正在检查同步内容…':'正在更新同步状态…',async()=>{
      await syncAction(name,{confirmed:action==='sync-confirm'});
      if(action==='sync-confirm' || action==='sync-now') notice=syncStatus.phase==='error'?syncStatus.lastError:syncStatus.conflicts.length?'其余记录已同步，冲突记录已保留。':'学习记录已同步。';
      if(action==='sync-logout') syncFields.code='';
    });
  }
  if(action==='data-export') return run('正在准备备份…',exportData);
  if(action==='data-pick') {
    if(!native) return app.querySelector('#backup-file').click();
    return run('正在选择备份…',async()=>{const f=await deviceBridge.importFile();if(!f.cancelled)await previewBackup(f.value);});
  }
  if(action==='data-cancel') {importBackup=null;importPreview=null;return render();}
  if(action==='data-confirm' && importBackup) return run('正在合并学习记录…',async()=>{
    await api('data/import',{backup:importBackup});const r=data.importSummary;
    importBackup=null;importPreview=null;notice=`已新增 ${r.added} 轮、更新 ${r.updated} 轮，跳过 ${r.skipped} 轮。`;
  });
  if(action==='chatgpt-refresh') return refreshAuth();
  if(action==='chatgpt-login') return run(native?'请在官方页面完成 ChatGPT 授权…':'正在准备 ChatGPT 授权…',async()=>{
    const result=await request('chatgpt/login',{accountId:el.dataset.id});
    if(native) {authStatus=result;planWelcome=!localStorage.getItem(`lsc-plan-notice-${authStatus.activeId}`);authModels=(await request('chatgpt/models')).models;notice='ChatGPT 授权已完成，选择模型并保存即可使用。';}
    else {authURL=result.url;authStatus={...authStatus,login:{state:'pending'}};authPoll=setTimeout(refreshAuth,3000);}
  });
  if(['chatgpt-select','chatgpt-logout','chatgpt-cancel'].includes(action)) return run('正在更新 ChatGPT 授权…',async()=>{
    clearTimeout(authPoll);authURL='';authModels=[];
    authStatus=await request(`chatgpt/${action.slice(8)}`,{accountId:el.dataset.id});
    if(authStatus.loggedIn)authModels=(await request('chatgpt/models')).models;
    if(settingsDraft)settingsDraft.model='';notice=authStatus.message || 'ChatGPT 账号已更新。';
  });
  if (['home','welcome','settings','review','session','profile','activity','week','wordbook'].includes(action)) return navigate(action);
  if (action === 'practice') { practiceMode = el.dataset.mode; return navigate('practice'); }
  if (action === 'exam') { examGoal = el.dataset.goal || goal; examRequestId=null; return navigate('exam'); }
  if (action === 'exam-assess') {
    if (!data.configured) return navigate('settings');
    examRequestId ||= crypto.randomUUID();
    return run('AI 正在分析练习记录，评估通过率…', async () => {
      await api('exam/assess',{goal:examGoal,requestId:examRequestId});examRequestId=null;
      notice='评估已更新，结果和依据已保存。';
    });
  }
  if (action === 'mark-word') {
    const scroll=app.querySelector('#chat-log')?.scrollTop, top=window.scrollY;
    await run('正在保存单词…',()=>api('vocabulary/mark',{sessionId:el.dataset.id,taskId:el.dataset.task,word:el.dataset.word,status:el.dataset.status}));
    const log=app.querySelector('#chat-log');if(log && scroll!==undefined)log.scrollTop=scroll;window.scrollTo({top,behavior:'instant'});return;
  }
  if (action === 'word-define') return fillWordMeanings(el.dataset.word);
  if (action === 'word-status') return run('正在更新单词本…',()=>api('vocabulary/status',{word:el.dataset.word,status:el.dataset.status}));
  if (action === 'word-source') {
    if(current()?.id===el.dataset.id) return navigate('session');
    summaryId=el.dataset.id;screen='summary';return run('正在读取原文…',async()=>{detailSession=await request(`session/detail?id=${encodeURIComponent(summaryId)}`);});
  }
  if (['activity-next','activity-prev','activity-retry'].includes(action)) {
    const offset = Math.max(0, (activityData?.offset || 0) + (action === 'activity-next' ? 20 : action === 'activity-prev' ? -20 : 0));
    return run('正在读取学习记录…', async () => { activityData = await request(`activity?offset=${offset}`); window.scrollTo({top:0,behavior:'instant'}); });
  }
  if (action === 'goal') return selectGoal(el.dataset.value);
  if (action === 'dismiss') { error = ''; return render(); }
  if (action === 'reload') return run('连接本地服务…', () => api('state'));
  if (action === 'history') { summaryId = el.dataset.id; detailSession = null; screen = 'summary'; window.scrollTo({ top: 0, behavior: 'instant' }); return run('正在读取练习记录…', async () => { detailSession = await request(`session/detail?id=${encodeURIComponent(summaryId)}`); }); }
  if (action === 'review-next' || action === 'review-prev') {
    const offset = Math.max(0, reviewOffset + (action === 'review-next' ? 20 : -20));
    return run('正在读取错题…', async () => { reviewData = await request(`review?goal=${encodeURIComponent(goal)}&offset=${offset}&filter=${reviewFilter}`); reviewOffset = offset; window.scrollTo({top:0,behavior:'instant'}); });
  }
  if (action === 'codex-refresh') return refreshCodex();
  if (['codex-login', 'codex-device', 'codex-cancel'].includes(action)) return run('正在连接 Codex 授权服务…', async () => {
    clearTimeout(codexPolling);
    codexStatus = await request(action === 'codex-cancel' ? 'codex/login/cancel' : 'codex/login', { type: action === 'codex-device' ? 'chatgptDeviceCode' : 'chatgpt' });
    if (codexStatus.login?.state === 'pending') codexPolling = setTimeout(refreshCodex, 3000);
  });
  if (action === 'test-connection') return run('正在测试已保存的模型…', async () => { await api('settings/test', {}); notice = '连接成功，模型已返回有效 JSON。可以开始学习了。'; });
  if (['start','retry-mistake','start-again','start-recommended','replace-round'].includes(action)) {
    if (!data.configured) { navigate('settings'); notice = '请先连接 AI，保存并测试配置后即可开始。'; return render(); }
    const input = action === 'start-again' ? starting : { goal: el.dataset.goal || goal, mode: el.dataset.mode || '综合', placement: false,
      ...(action === 'retry-mistake' ? {reviewId:el.dataset.id, ...(el.dataset.questionIndex !== undefined ? {reviewQuestionIndex:Number(el.dataset.questionIndex)} : {})} : {}),
      ...(action === 'start-recommended' ? el.dataset.id ? {recommendationId:el.dataset.id} : {useProfileFocus:true} : {}) };
    if (action === 'replace-round') { const active = current(); if (!active) return navigate('home'); input.replaceSessionId = active.id; input.draftTaskId = active.current.id; input.draftAnswer = draft.taskId === active.current.id ? draft.answer || '' : ''; }
    goal=input.goal;localStorage.setItem('lsc-goal-v1',goal);
    starting = input; screen = 'starting';
    const operation = run('AI 正在准备第一道题…', async () => {
      try {
        await api('session/start', input); screen = 'session';
      } catch (startError) {
        // The server writes state before sending its response. If the browser loses that
        // response during a slow Codex turn, recover the committed session automatically.
        try {
          await api('state');
          if (current()?.goal === goal && current()?.mode === input.mode && current()?.current && (!input.replaceSessionId || current().id !== input.replaceSessionId)) {
            screen = 'session';
            notice = '这一轮已经准备好了，刚才的连接响应没有及时返回。';
            return;
          }
        } catch { /* Preserve the original actionable error below. */ }
        throw startError;
      }
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
    app.querySelector('#starting-title')?.focus({ preventScroll: true });
    return operation;
  }
  const s = current(); if (!s) return;
  if (action === 'regrade') {
    draft.regradeRequests ||= {};
    draft.regradeRequests[el.dataset.id] ||= crypto.randomUUID(); persistDraft();
    return run('正在结合原回答与追问复核批改…', async () => {
      await api('session/regrade', { sessionId: s.id, taskId: el.dataset.id, requestId: draft.regradeRequests[el.dataset.id] });
      delete draft.regradeRequests[el.dataset.id]; persistDraft();
      notice = '批改已复核，题数和作答时长没有重复累计。';
    });
  }
  if (['composer-answer', 'composer-coach', 'discuss-task'].includes(action)) {
    stopMedia();
    draft.coachRequestId = null;
    draft.composerMode = action === 'composer-answer' ? 'answer' : 'coach';
    draft.discussTaskId = action === 'discuss-task' ? el.dataset.id : s.current.id;
    persistDraft(); render(); app.querySelector(draft.composerMode === 'coach' ? '#coach-message' : '#answer-text')?.focus({ preventScroll: true });
    return;
  }
  if (action === 'send-coach') {
    const message = (draft.coachMessage || '').trim();
    if (!message) return;
    const target = discussionTarget(s, draft);
    draft.coachRequestId ||= crypto.randomUUID(); persistDraft();
    pendingChat = { taskId: target.id, text: message }; chatScrollToEnd = true;
    return run('教练正在看你的问题…', async () => {
      await api('session/discuss', { sessionId: s.id, taskId: target.id, message, requestId: draft.coachRequestId, draftAnswer: draft.answer });
      draft.coachMessage = ''; draft.coachRequestId = null; persistDraft(); chatScrollToEnd = true;
    });
  }
  if (action === 'answer-option') {
    const items = taskQuestions(s.current), questionIndex = Number(el.dataset.questionIndex || 0), option = items[questionIndex]?.options[Number(el.dataset.index)];
    if (option === undefined) return;
    draft.skippedQuestions=(draft.skippedQuestions || []).filter(i=>i!==questionIndex);
    if (items.length === 1) draft.answer = option;
    else { let values; try { values = JSON.parse(draft.answer || '[]'); } catch { values = []; } if (!Array.isArray(values) || values.length !== items.length) values = Array(items.length).fill(''); values[questionIndex] = option; draft.answer = JSON.stringify(values); }
    persistDraft(); return render();
  }
  if (action === 'hint') { draft.hintUsed = true; persistDraft(); return render(); }
  if (action === 'transcript') { draft.transcriptViewed = true; persistDraft(); return render(); }
  if (action === 'audio' || action === 'replay') return playAudio(action === 'replay');
  if (action === 'voice') return voiceInput(el.dataset.field || 'answer',el.dataset.questionIndex === undefined ? null : Number(el.dataset.questionIndex));
  if (action === 'submit') {
    pendingChat = { taskId: s.current.id, text: draft.answer }; chatScrollToEnd = true;
    return run(s.history.length + 1 < s.targetCount ? '正在批改并准备下一题…' : '正在认真看你的回答…', async () => {
      await api('session/answer', { sessionId: s.id, ...draft }); draft.composerMode = 'coach'; persistDraft(); chatScrollToEnd = true;
    });
  }
  if (action === 'next') { chatScrollToEnd = true; return run(s.nextReady ? '正在切换到下一题…' : '正在结合你的表现安排下一题…', () => api('session/next', { sessionId: s.id, taskId: s.current.id })); }
  if (action === 'finish') return run(s.history.length ? '正在整理学习小结与下一步建议…' : '正在结束本轮…', async () => {
    await api('session/finish', { sessionId: s.id, draftTaskId:s.current.id, draftAnswer:draft.taskId===s.current.id ? draft.answer || '' : '' }); summaryId = s.id; detailSession = await request(`session/detail?id=${encodeURIComponent(s.id)}`); screen = 'summary';
  });
});
app.addEventListener('input', event => {
  if(event.target.id==='wordbook-search'){wordQuery=event.target.value;const fragment=document.createElement('div');fragment.innerHTML=renderWordbook({data,esc,button,query:wordQuery,filter:wordFilter});app.querySelector('.wordbook-list')?.replaceWith(fragment.querySelector('.wordbook-list'));return;}
  if(event.target.closest('#sync-panel') && event.target.name) syncFields[event.target.name]=event.target.value;
  if (event.target.classList.contains('task-text-answer')) {
    let values; try { values = JSON.parse(draft.answer || '[]'); } catch { values = []; }
    const items = taskQuestions(current()?.current); if (!Array.isArray(values) || values.length !== items.length) values = Array(items.length).fill('');
    clearSkip(Number(event.target.dataset.questionIndex));
    values[Number(event.target.dataset.questionIndex)] = event.target.value; draft.answer = JSON.stringify(values); persistDraft();
    const submit = app.querySelector('[data-action="submit"]'); if (submit) submit.disabled = !answerComplete(current()?.current, draft.answer); return;
  }
  if (event.target.id === 'answer-text') { clearSkip(0); draft.answer = event.target.value; persistDraft(); const submit = app.querySelector('[data-action="submit"]'); if (submit) submit.disabled = !answerComplete(current()?.current, draft.answer); }
  if (event.target.id === 'coach-message') { draft.coachMessage = event.target.value; draft.coachRequestId = null; persistDraft(); const send = app.querySelector('[data-action="send-coach"]'); if (send) send.disabled = !draft.coachMessage.trim(); }
  if (event.target.id === 'model-search') {
    modelCatalog.query = event.target.value;
    const select = app.querySelector('#upstream-model');
    if (select) select.innerHTML = renderModelOptions({models:modelCatalog.models,query:modelCatalog.query,current:settingsDraft.model,esc});
    return;
  }
  if (event.target.closest('#settings-form') && event.target.name) {
    settingsDraft = { ...settingsDraft, [event.target.name]: event.target.value };
    if (['baseURL','apiKey'].includes(event.target.name)) {
      // Editing an address must never automatically send the draft key there.
      if (event.target.name === 'baseURL') {settingsDraft.apiKey = ''; app.querySelector('[name="apiKey"]').value = '';}
      resetModelCatalog(); paintModelPicker();
      if (event.target.name === 'baseURL') app.querySelector('[name="apiKey"]').placeholder = sameSavedSource(settingsDraft) && data.config?.hasKey ? '已保存；留空可继续使用' : '粘贴你的 API Key';
      autoFetchModels(700);
    }
    if (event.target.name === 'model' && event.target.tagName === 'INPUT') modelCatalog.manual = true;
  }
});
app.addEventListener('change', event => {
  if(event.target.id==='wordbook-filter'){wordFilter=event.target.value;return render();}
  if (event.target.closest('#settings-form') && ['baseURL','apiKey'].includes(event.target.name)) autoFetchModels();
  if (event.target.name === 'model') settingsDraft = {...settingsDraft,model:event.target.value};
  if(event.target.id==='backup-file') {
    const file=event.target.files[0];if(!file)return;
    return run('正在检查备份…',async()=>{if(file.size>20*1024*1024)throw new Error('备份超过 20 MB。');await previewBackup(await file.text());});
  }
  if (event.target.id === 'dashboard-goal') return selectGoal(event.target.value);
  if (event.target.name === 'provider') {
    clearTimeout(codexPolling); clearTimeout(authPoll); authURL = ''; authModels = [];
    resetModelCatalog();
    settingsDraft = { provider: event.target.value, baseURL: data.providers[event.target.value].baseURL, model: '', apiKey: '' };
    render(); if (settingsDraft.provider === 'codex') refreshCodex();
    if (settingsDraft.provider === 'chatgpt') refreshAuth();
    autoFetchModels();
    refreshSync();
  }
  if (event.target.id === 'audio-speed') { speed = Number(event.target.value); if (audioState !== 'idle') playAudio(true); }
});
app.addEventListener('submit', event => {
  if(event.target.id==='sync-login-form') {
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));
    return run('正在验证邮箱…',async()=>{
      await syncAction('verify',values);syncFields.code='';
      notice='邮箱已验证。开启同步前可以先查看数据数量。';
    });
  }
  if (event.target.id === 'chat-composer') { event.preventDefault(); app.querySelector(`[data-action="${isDiscussing(current(), draft) ? 'send-coach' : 'submit'}"]`)?.click(); return; }
  if (event.target.id === 'learning-plan-form') {
    event.preventDefault(); const input=Object.fromEntries(new FormData(event.target));
    return run('正在保存学习安排…', async()=>{await api('learning-plan',input);notice='学习安排已保存，之后出题会参考你的时间、日期和场景。';});
  }
  if (event.target.id !== 'settings-form') return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); settingsDraft = values;
  run('正在保存本机配置…', async () => { await api('settings', values); settingsDraft = { ...data.config, apiKey: '' }; notice = '配置已保存。可以测试连接，或回到学习页开始练习。'; });
});
app.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[role="tab"][data-action="settings-section"]');
  if (tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
    event.preventDefault();
    const tabs = [...app.querySelectorAll('[data-action="settings-section"]')];
    const index = tabs.indexOf(tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus(); return;
  }
  const card = event.target.closest?.('[data-action][role="link"]');
  if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); card.click(); return; }
  if (!event.target.closest('.chat-session') || event.target.tagName !== 'TEXTAREA' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  if (event.target.classList.contains('task-text-answer')) {
    event.preventDefault();
    const fields = [...app.querySelectorAll('.task-text-answer')], index = fields.indexOf(event.target), next = fields[index + 1];
    if (next) next.focus(); else app.querySelector('[data-action="submit"]')?.click();
    return;
  }
  event.preventDefault(); app.querySelector(`[data-action="${event.target.id === 'coach-message' ? 'send-coach' : 'submit'}"]`)?.click();
});
app.addEventListener('cancel',event=>{if(event.target.matches('.plan-welcome')){event.preventDefault();app.querySelector('[data-action="plan-notice-close"]')?.click();}},true);
['pointerdown','keydown','input'].forEach(type => document.addEventListener(type, () => { lastActivity = Date.now(); }));
document.addEventListener('visibilitychange', () => { lastActivity = Date.now(); if (document.hidden) { stopMedia(); persistDraft(); } else {if (screen === 'session') render();automaticSync();} });
setInterval(() => {
  if (screen === 'session' && !busy && !document.hidden && current()?.current && !current().feedback && !draft.timerPaused) {
    draft.activeSeconds = Math.min(1800, (draft.activeSeconds || 0) + 1);const timer=app.querySelector('#practice-timer');if(timer)timer.textContent=`本题前台用时 ${duration(draft.activeSeconds)}`; if (draft.activeSeconds % 5 === 0) persistDraft();
  }
}, 1000);
window.addEventListener('online',automaticSync);
window.addEventListener('focus',automaticSync);
setInterval(automaticSync,60000);
window.addEventListener('pagehide', () => { stopMedia(); persistDraft(); });
let fieldScrollTimer;
function scheduleFocusedField() {
  clearTimeout(fieldScrollTimer);
  fieldScrollTimer = setTimeout(() => keepFocusedFieldVisible(document.activeElement), 80);
}
function updateViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height',`${height}px`);
  if (!native) document.documentElement.classList.toggle('keyboard-open', window.innerHeight - height > 120 && document.activeElement?.matches?.('input,textarea'));
  scheduleFocusedField();
}
function keepFocusedFieldVisible(field) {
  if (!field || !field.isConnected || !field.matches?.('input,textarea,select,[contenteditable="true"]')) return;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || window.innerHeight);
  const rect = field.getBoundingClientRect(), log = field.closest('#chat-log'), margin = 16;
  if (log) {
    // Multi-question answer fields scroll inside the conversation, never by
    // moving the entire WebView past the fixed composer.
    const area = log.getBoundingClientRect(), visibleTop = Math.max(top, area.top) + margin, visibleBottom = Math.min(bottom, area.bottom) - margin;
    if (rect.bottom > visibleBottom) log.scrollTop += Math.min(rect.bottom - visibleBottom, rect.top - visibleTop);
    else if (rect.top < visibleTop) log.scrollTop -= visibleTop - rect.top;
  } else if (!field.closest('.chat-bottom') && (rect.top < top + margin || rect.bottom > bottom - margin)) {
    field.scrollIntoView({ block:'center', inline:'nearest', behavior:'auto' });
  }
}
document.addEventListener('focusin', event => {
  if (event.target.matches?.('input,textarea,select,[contenteditable="true"]')) scheduleFocusedField();
});
window.visualViewport?.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('scroll',updateViewport);window.addEventListener('resize',updateViewport);updateViewport();
if(native) deviceBridge.safeArea().then(i=>{for(const edge of ['top','bottom','left','right'])document.documentElement.style.setProperty(`--safe-${edge}`,`${i[edge]}px`);}).catch(()=>{});
const chatGPTReturn = new URLSearchParams(location.search).get('chatgpt');
if (chatGPTReturn) history.replaceState(null, '', location.pathname);
run('读取学习记录…', async () => {
  await api('state');
  if (chatGPTReturn) {
    screen = 'settings';
    settingsDraft = { ...(data?.config || { provider: 'chatgpt', baseURL: '', model: '' }), provider: 'chatgpt', apiKey: '' };
    refreshAuth();
    refreshSync();
  } else if (current()) { goal = current().goal; screen = 'session'; }
}).then(automaticSync);
