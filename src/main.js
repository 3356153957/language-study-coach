
import './style.css';
import './dashboard.css';
import { renderDashboard, renderProfile, renderActivity, renderPractice } from './dashboard.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { renderDataSettings, renderChatGPTPanel, renderSyncPanel } from './settings-panels.js';
const deviceBridge = registerPlugin('StudyDevice');
const native = Capacitor.isNativePlatform();
const defaultProvider = native ? 'openai' : 'codex';
let nativeClient;

import { icon, skillIcon, modeName } from './icons.js';
import { renderLearningChat, discussionTarget, isDiscussing } from './chat.js';
import { createListeningPlayer } from './listening-player.js';

const app = document.querySelector('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const presets = [
  ['四六级', '四级', 'CET-4 / CET-6', '循序补齐考试需要的英语能力', 'violet', 'Aa'],
  ['高中英语', '高中英语', 'HIGH SCHOOL', '读懂长句，学会准确地表达', 'orange', '↗'],
  ['初中英语', '初中英语', 'MIDDLE SCHOOL', '从基础词汇和句型开始', 'blue', 'ab'],
  ['日常英语', '日常英语', 'EVERYDAY ENGLISH', '听懂、开口，在生活里用起来', 'green', 'Hi'],
];
let data = null, goal = localStorage.getItem('lsc-goal-v1') || '';
let screen = goal ? 'home' : 'welcome';
let busy = '', error = '', notice = '', settingsDraft = null, summaryId = null, draft = {};
let detailSession = null, reviewData = null, reviewOffset = 0;
let activityData = null, practiceMode = '听力';
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let pendingChat = null, chatScrollToEnd = true, starting = null;
let authStatus = null, authModels = [], authURL = '', authLoading = false, authPoll = null;
let importBackup = null, importPreview = null;
let syncStatus=null,syncPreview=null,syncRunning=false;
const syncFields={url:'',publishableKey:'',email:'',code:''};
let planWelcome = false;
let codexStatus = null, codexLoading = false, codexError = '', codexPolling = null;
try { draft = JSON.parse(sessionStorage.getItem('lsc-answer-v1') || '{}'); } catch { /* Replace invalid tab draft. */ }
let lastActivity = Date.now(), recognition = null, audioState = 'idle', voiceMessage = '', speed = 1;
const current = () => data?.sessions.find(x => !x.finishedAt);
const persistDraft = () => sessionStorage.setItem('lsc-answer-v1', JSON.stringify(draft));
const listeningPlayer = createListeningPlayer({
  synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance,
  onState: state => { audioState = state; if (screen === 'session' && data) render(); },
  onStarted: () => { draft.replays = (draft.replays || 0) + 1; persistDraft(); lastActivity = Date.now(); },
  onError: message => { error = message; render(); },
});
function syncDraft() {
  const task = current()?.current;
  if (task && task.id !== draft.taskId) {
    draft = { taskId: task.id, answer: '', activeSeconds: 0, hintUsed: false, replays: 0, transcriptViewed: false, coachMessage: '', composerMode: 'answer', discussTaskId: task.id };
    chatScrollToEnd = true;
    if (current().feedback) {
      const saved = current().history.at(-1);
      for (const key of ['answer', 'activeSeconds', 'hintUsed', 'replays', 'transcriptViewed']) draft[key] = saved[key];
    }
    audioState = 'idle'; voiceMessage = ''; persistDraft();
  }
}
const button = (label, action, cls = 'primary-button', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${busy ? 'disabled' : ''} ${attrs}>${label}</button>`;
const duration = sec => sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
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
  const res = await fetch(`/api/${path}${path.includes('?') ? '&' : '?'}compact=1&tz=${encodeURIComponent(timeZone)}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Request': '1' }, body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || '本地服务暂时不可用。');
  return result;
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
function syncPanel() { return renderSyncPanel({status:syncStatus,fields:syncFields,preview:syncPreview,activity:/同步|验证码|邮箱/.test(busy)?busy:'',esc,button}); }
function paintSync() {
  const panel=app.querySelector('#sync-panel');
  if(panel && !panel.contains(document.activeElement) && !busy) panel.outerHTML=syncPanel();
}
async function refreshSync() {
  try {syncStatus=await request('sync/status');paintSync();} catch(e) {if(screen==='settings'){error=e.message;render();}}
}
async function syncAction(name,input={}) {
  if(syncRunning && !['disable','logout'].includes(name)) throw new Error('同步正在进行，请稍后重试。');
  syncRunning=true;
  try {
    const result=await request(`sync/${name}`,input);
    syncStatus=result.status;syncPreview=result.preview || null;
    if(result.state) {data=result.state;syncDraft();}
    return result;
  } finally {syncRunning=false;}
}
async function automaticSync() {
  if(busy || syncRunning || document.hidden || navigator.onLine===false) return;
  syncRunning=true;
  const before=data;
  try {
    syncStatus=await request('sync/status');
    if(syncStatus.enabled) {
      const result=await request('sync/run',{});syncStatus=result.status;
      if(!busy && before===data && result.state) {data=result.state;syncDraft();if(['home','welcome','profile'].includes(screen))render();}
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
  finally { busy = ''; pendingChat = null; lastActivity = Date.now(); render(); }
}
function navigate(target) {
  stopMedia(); error = ''; notice = ''; screen = target;
  clearTimeout(codexPolling); clearTimeout(authPoll);
  if (target !== 'summary') detailSession = null;
  if (target !== 'review') { reviewData = null; reviewOffset = 0; }
  if (!['activity','week'].includes(target)) activityData = null;
  if (target !== 'settings') { settingsDraft = null; codexStatus = null; authURL = ''; importBackup = null; importPreview = null; }
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (target === 'activity' || target === 'week') {
    activityData = null;
    return run('正在读取学习记录…', async () => { activityData = await request('activity?offset=0'); });
  }
  if (target === 'review') {
    reviewOffset = 0; reviewData = null;
    window.scrollTo({ top: 0, behavior: 'instant' });
    return run('正在读取错题…', async () => { reviewData = await request(`review?goal=${encodeURIComponent(goal)}&offset=0`); });
  }
  if (target === 'profile') {
    return run('正在读取能力详情…', async () => { const profile = await request('profile'); data = { ...data, ...profile }; });
  }
  clearTimeout(codexPolling); clearTimeout(authPoll);
  if (target === 'settings') {
    settingsDraft = { ...(data?.config || { provider: defaultProvider, baseURL: native ? 'https://api.openai.com/v1' : '', model: '' }), apiKey: '' };
    if (settingsDraft.provider === 'codex') refreshCodex();
    if (settingsDraft.provider === 'chatgpt') refreshAuth();
    refreshSync();
  }
  render(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function selectGoal(value) { goal = value; localStorage.setItem('lsc-goal-v1', goal); navigate('home'); }
function render() {
  const navScreen = ['activity','week','summary','practice'].includes(screen) ? 'home' : screen;
  const previousLog = app.querySelector('#chat-log');
  const previousScroll = previousLog?.scrollTop || 0;
  const nearEnd = !previousLog || previousLog.scrollHeight - previousScroll - previousLog.clientHeight < 100;
  app.innerHTML = `<div class="shell ${screen === 'session' ? 'session-shell' : ''}"><header class="topbar">
    <nav class="topnav" aria-label="主导航">${[['home','学习'],['profile','进展'],['review','错题'],['settings','设置']].map(([key, label]) => button(icon({home:'read',profile:'target',review:'history',settings:'settings'}[key]) + label, key, `nav-link ${navScreen === key ? 'active' : ''}`, navScreen === key ? 'aria-current="page"' : '')).join('')}</nav>
    </header><main class="main-content ${screen === 'session' ? 'chat-main' : ''}">
      ${error ? `<div class="alert error" role="alert">${esc(error)} ${button('关闭', 'dismiss', 'text-button')}</div>` : ''}
      ${notice ? `<div class="alert success" role="status">${esc(notice)}</div>` : ''}
      ${busy && screen !== 'session' && screen !== 'starting' ? `<div class="busy-banner" role="status"><span class="spinner"></span>${esc(busy)}</div>` : ''}
      ${!data ? `<div class="empty-state"><h2>正在读取学习记录</h2><p>${native ? '学习记录保存在这台手机。' : '学习记录保存在这台电脑。'}</p>${button('重新连接', 'reload')}</div>` : page()}
    </main>${planWelcome?`<dialog class="plan-welcome" aria-modal="true" aria-label="你正在使用 ChatGPT 订阅"><h2>你正在使用 ChatGPT 订阅</h2><p>本应用中符合条件的出题、批改和追问会使用你的订阅额度。你可以在 ChatGPT 用量设置中管理限额或断开授权。</p>${button('知道了','plan-notice-close')}</dialog>`:''}</div>`;
  if(planWelcome) app.querySelector('.plan-welcome')?.showModal();
  const log = app.querySelector('#chat-log');
  if (log) {
    // The first prompt should start at its top. Later turns stay anchored to the
    // newest message so the learner sees feedback and the prepared next task.
    const firstPrompt = !current()?.history?.length && !pendingChat;
    log.scrollTop = firstPrompt ? 0 : (chatScrollToEnd || nearEnd ? log.scrollHeight : previousScroll);
    chatScrollToEnd = false;
  }
}
function page() {
  if (screen === 'settings') return settings();
  if (screen === 'profile') return renderProfile({ data, esc, button });
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
  return `<section class="welcome-page"><div class="welcome-copy"><span class="eyebrow">YOUR OWN ENGLISH COACH</span><h1>从你的起点，<br>学到<em>用得出来。</em></h1><p>选一个适合你的学习目标。直接从日常练习开始，让 AI 根据每次回答了解你，逐步安排下一步。</p><div class="welcome-note"><span class="spark">✦</span>不用研究学习路线，先从一道题开始。</div></div>
    <div class="preset-panel"><div class="panel-heading">你想从哪里开始？<span class="muted">随时可以更换</span></div><div class="preset-grid">${presets.map(([name, value, tag, detail, color, icon]) => `<button class="preset-card ${color}" data-action="goal" data-value="${value}" ${busy ? 'disabled' : ''}><span class="card-arrow">↗</span><span class="preset-icon">${icon}</span><span class="preset-text"><span class="preset-eyebrow">${tag}</span><strong>${name}</strong><span>${detail}</span></span></button>`).join('')}</div><div class="panel-footer">四个学习目标 · 一个会逐步了解你的教练</div></div></section>`;
}
function home() { return renderDashboard({ data, goal, esc, button, date }); }
function settings() {
  const cfg = settingsDraft || { provider: defaultProvider, baseURL: native ? 'https://api.openai.com/v1' : '', model: '', apiKey: '' };
  return `<section class="settings-page"><span class="eyebrow">MAKE IT YOURS</span><h1>连接你的 <em>AI。</em></h1><p class="lead">选择模型，把它变成了解你的英语教练。</p><div class="settings-grid"><form id="settings-form" class="card-surface settings-form">
    <label>服务商<select name="provider" ${busy ? 'disabled' : ''}>${Object.entries(data.providers).map(([key, p]) => `<option value="${key}" ${cfg.provider === key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
    ${cfg.provider === 'chatgpt' ? renderChatGPTPanel({status:authStatus,loading:authLoading,models:authModels,authURL,cfg,esc,button}) : cfg.provider === 'codex' ? codexPanel(cfg) : `<label>API 地址<input name="baseURL" type="url" required value="${esc(cfg.baseURL)}" placeholder="https://your-provider.example/v1" ${busy ? 'disabled' : ''}></label><p class="field-help">填写基础地址，通常以 /v1 结尾；不包含 /chat/completions。</p>
    <label>模型 ID<input name="model" required maxlength="200" value="${esc(cfg.model)}" placeholder="填写供应商控制台中的模型名称" ${busy ? 'disabled' : ''}></label>
    <label>API Key<input name="apiKey" type="password" autocomplete="off" value="${esc(cfg.apiKey)}" placeholder="${data.config?.hasKey ? '已保存；同一地址留空可继续使用' : '粘贴你的 API Key'}" ${busy ? 'disabled' : ''}></label>
    <div class="form-actions"><button type="submit" class="primary-button" ${busy ? 'disabled' : ''}>保存配置</button>${button('测试已保存的连接', 'test-connection', 'secondary-button', data.configured ? '' : 'disabled')}</div>`}</form>
    <aside class="settings-note"><span class="note-symbol">✦</span><h2>${cfg.provider === 'chatgpt' ? '使用 ChatGPT 订阅，<br>开始学英语。' : cfg.provider === 'codex' ? '用已经熟悉的 Codex，<br>开始学英语。' : '一个接口，完整学习流程。'}</h2>${cfg.provider === 'chatgpt' ? '<p>在系统浏览器的官方页面授权。登录身份会经过校验，账号凭据单独保存在当前设备。</p><p>出题、批改和追问会使用你的订阅额度。可以在 ChatGPT 设置中管理或撤销本应用的授权。</p>' : cfg.provider === 'codex' ? '<p>复用这台电脑上 Codex 的登录状态，无需填写 API Key。未登录时，在官方页面完成 ChatGPT 授权即可。</p><p>授权凭据由 Codex 管理，学习软件不复制令牌。新授权会用于这台电脑共享的 Codex 登录。</p><p>出题与批改使用你的 Codex 账户额度。学习内容会发给 OpenAI；此接入用于本地个人版。</p>' : '<p>AI 负责出题、批改、解释和安排下一题。兼容接口可用于供应商提供的 OpenAI 兼容服务。</p><p>密钥与学习记录保存在当前设备，学习内容只发送给你选择的模型服务商。</p><p>学习内容会发送给所选供应商，按其 API 用量计费。</p>'}<p>${native ? '听力使用系统英语语音。语音输入使用 iPhone 键盘听写，确认文字后再提交。' : '听力使用系统英语语音。浏览器语音输入转成文字后可编辑再提交，可能使用浏览器厂商的语音服务。'}</p></aside></div>${renderDataSettings({preview:importPreview,esc,button})}${syncPanel()}</section>`;
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
  const report = s.report;
  return `<section class="summary-page"><span class="summary-icon">✓</span><span class="eyebrow">ONE STEP FURTHER</span><h1>这一轮，<em>有所收获。</em></h1><p>${esc(report?.summary || '本轮没有提交答案，未生成能力判断。')}</p><div class="summary-grid"><div><span>完成</span><strong>${s.history.length}<small> 题</small></strong></div><div><span>回答正确</span><strong>${s.history.filter(x => x.feedback.correct).length}<small> 题</small></strong></div><div><span>有效作答</span><strong class="summary-time">${duration(s.history.reduce((n, x) => n + x.activeSeconds, 0))}</strong></div></div>${report ? `<div class="summary-focus"><span class="spark">✦</span><div><strong>下一步，试试这个方向</strong><p>${esc(report.nextFocus)}</p></div></div><p class="fine-print">AI 初步判断：${esc(report.level)} · 仅根据已有作答，不代表正式考试成绩。</p>` : ''}${roundReview(s)}<div class="form-actions">${button('回到学习页', 'home')}${button('回顾错题', 'review', 'secondary-button')}</div></section>`;
}
function roundReview(session) {
  if (!session.history.length) return '';
  return `<section class="round-review" aria-label="本轮逐题回顾"><div class="section-title"><h2>本轮逐题回顾</h2><span class="muted">展开看回答与解析</span></div>${session.history.map((entry, index) => {
    const task = entry.task, feedback = entry.feedback;
    const helpers = [entry.hintUsed && '使用了提示', entry.replays > 0 && `播放听力 ${entry.replays} 次`, entry.transcriptViewed && '查看了听力原文'].filter(Boolean);
    return `<details class="round-question"><summary><span class="round-number">${index + 1}</span><span class="round-question-title"><strong>${esc(task.skill)} · ${esc(task.level)}</strong><span>${esc(task.prompt)}</span></span><span class="round-result ${feedback.correct ? 'right' : 'wrong'}">${feedback.correct ? '答对' : '再巩固'}</span></summary><div class="round-answer">
      ${task.passage ? `<div class="reading-passage" lang="en">${esc(task.passage)}</div>` : ''}${task.audio ? `<div class="round-material"><strong>听力原文</strong><p lang="en">${esc(task.audio)}</p></div>` : ''}
      ${task.options.length ? `<ol class="round-options" type="A">${task.options.map(option => `<li lang="en">${esc(option)}</li>`).join('')}</ol>` : ''}
      <div class="round-answer-pair"><div><span>你的回答</span><p lang="en">${esc(entry.answer)}</p></div><div><span>参考答案</span><p lang="en">${esc(task.answer)}</p></div></div>
      <div class="round-explanation"><strong>理解这道题</strong><p>${esc(feedback.explanation)}</p>${feedback.suggestion ? `<p><strong>表达建议</strong><br>${esc(feedback.suggestion)}</p>` : ''}</div>
      ${(session.discussions?.[task.id] || []).length ? `<details class="saved-discussion"><summary>查看这道题的追问记录</summary>${session.discussions[task.id].map(turn => `<div><strong>你</strong><p class="chat-text">${esc(turn.message)}</p><strong>英语教练</strong><p class="chat-text">${esc(turn.reply)}</p></div>`).join('')}</details>` : ''}
      <p class="field-help">作答 ${duration(entry.activeSeconds)}${helpers.length ? ` · ${helpers.join(' · ')}` : ''}</p>
    </div></details>`;
  }).join('')}</section>`;
}
function reviewPage() {
  if (!reviewData) return '<div class="empty-state">正在读取错题…</div>';
  const mistakes = reviewData.items;
  return `<section class="review-page"><h1>错题回顾</h1><p class="review-lead">${esc(goal)} · ${reviewData.total} 道错题</p><div class="review-list">${mistakes.length ? mistakes.map(m => `<article class="review-item"><div class="review-item-top"><span class="skill-tag">${m.task.skill}</span><span>${date(m.at)}</span></div><h2>${esc(m.feedback.weakness)}</h2><p>${esc(m.task.prompt)}</p><details><summary>查看回答与解析</summary>${m.task.passage ? `<p>${esc(m.task.passage)}</p>` : ''}${m.task.audio ? `<p>${esc(m.task.audio)}</p>` : ''}<p>你的回答：${esc(m.answer)}</p><p>参考答案：${esc(m.task.answer)}</p><p>${esc(m.feedback.explanation)}</p></details>${button('换道题再练一次 →', 'retry-mistake', 'text-button', `data-id="${m.id}" ${current() ? 'disabled' : ''}`)}</article>`).join('') : `<div class="empty-state"><span>✦</span><h2>这里会留下值得再练的知识点</h2><p>完成练习后，答错的题目和解析会自动整理到这里。</p>${button('开始学习', 'home')}</div>`}</div>${reviewData.total > 20 ? `<div class="review-pagination">${button('上一页','review-prev','secondary-button', reviewOffset ? '' : 'disabled')}<span>${Math.floor(reviewOffset/20)+1} / ${Math.ceil(reviewData.total/20)}</span>${button('下一页','review-next','secondary-button', reviewData.hasMore ? '' : 'disabled')}</div>` : ''}${current() ? `<p class="help">完成当前练习后可重练错题。</p>` : ''}</section>`;
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
function voiceInput(field = 'answer') {
  if (native) {
    voiceMessage = '点击 iPhone 键盘上的麦克风听写，确认文字后再提交。'; render();
    app.querySelector(field === 'coachMessage' ? '#coach-message' : '#answer-text')?.focus(); return;
  }
  if (recognition) { recognition.stop(); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { voiceMessage = '此浏览器不支持语音转写，请用键盘输入或换用支持的浏览器。'; render(); return; }
  stopMedia();
  const taskId = current().current.id, before = draft[field] || '';
  const r = new SpeechRecognition(); recognition = r; r.lang = field === 'coachMessage' ? 'zh-CN' : 'en-US'; r.interimResults = false; r.continuous = false;
  r.onresult = event => {
    if (draft.taskId !== taskId || recognition !== r) return;
    draft[field] = `${before} ${event.results[0][0].transcript}`.trim().slice(0, field === 'coachMessage' ? 2000 : 4000);
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
app.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el || busy || el.disabled) return;
  const action = el.dataset.action;
  if(action==='plan-notice-close') {if(authStatus?.activeId)localStorage.setItem(`lsc-plan-notice-${authStatus.activeId}`,'seen');planWelcome=false;return render();}
  if(action==='sync-code') return run('正在发送验证码…',async()=>{await syncAction('send-code',{email:syncFields.email || syncStatus?.email});notice='验证码已发送，请查看邮箱；一分钟后可重新发送。';});
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
  if (['home','welcome','settings','review','session','profile','activity','week'].includes(action)) return navigate(action);
  if (action === 'practice') { practiceMode = el.dataset.mode; return navigate('practice'); }
  if (action === 'exam') {
    const examGoal = el.dataset.goal;
    await navigate('profile');
    const details = [...app.querySelectorAll('[data-exam]')].find(x => x.dataset.exam === examGoal);
    if (details) { details.open = true; details.scrollIntoView({ block: 'center', behavior: 'smooth' }); details.querySelector('summary').focus({ preventScroll: true }); }
    return;
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
    return run('正在读取错题…', async () => { reviewData = await request(`review?goal=${encodeURIComponent(goal)}&offset=${offset}`); reviewOffset = offset; window.scrollTo({top:0,behavior:'instant'}); });
  }
  if (action === 'codex-refresh') return refreshCodex();
  if (['codex-login', 'codex-device', 'codex-cancel'].includes(action)) return run('正在连接 Codex 授权服务…', async () => {
    clearTimeout(codexPolling);
    codexStatus = await request(action === 'codex-cancel' ? 'codex/login/cancel' : 'codex/login', { type: action === 'codex-device' ? 'chatgptDeviceCode' : 'chatgpt' });
    if (codexStatus.login?.state === 'pending') codexPolling = setTimeout(refreshCodex, 3000);
  });
  if (action === 'test-connection') return run('正在测试已保存的模型…', async () => { await api('settings/test', {}); notice = '连接成功，模型已返回有效 JSON。可以开始学习了。'; });
  if (['start','retry-mistake','start-again'].includes(action)) {
    if (!data.configured) { navigate('settings'); notice = '请先连接 AI，保存并测试配置后即可开始。'; return render(); }
    const input = action === 'start-again' ? starting : { goal, mode: el.dataset.mode || '综合', placement: false, reviewId: el.dataset.id };
    starting = input; screen = 'starting';
    const operation = run('AI 正在准备第一道题…', async () => {
      try {
        await api('session/start', input); screen = 'session';
      } catch (startError) {
        // The server writes state before sending its response. If the browser loses that
        // response during a slow Codex turn, recover the committed session automatically.
        try {
          await api('state');
          if (current()?.goal === goal && current()?.mode === input.mode && current()?.current) {
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
  if (action === 'answer-option') { draft.answer = s.current.options[Number(el.dataset.index)]; persistDraft(); return render(); }
  if (action === 'hint') { draft.hintUsed = true; persistDraft(); return render(); }
  if (action === 'transcript') { draft.transcriptViewed = true; persistDraft(); return render(); }
  if (action === 'audio' || action === 'replay') return playAudio(action === 'replay');
  if (action === 'voice') return voiceInput(el.dataset.field || 'answer');
  if (action === 'submit') {
    pendingChat = { taskId: s.current.id, text: draft.answer }; chatScrollToEnd = true;
    return run(s.history.length + 1 < s.targetCount ? '正在批改并准备下一题…' : '正在认真看你的回答…', async () => {
      await api('session/answer', { sessionId: s.id, ...draft }); draft.composerMode = 'coach'; persistDraft(); chatScrollToEnd = true;
    });
  }
  if (action === 'next') { chatScrollToEnd = true; return run(s.nextReady ? '正在切换到下一题…' : '正在结合你的表现安排下一题…', () => api('session/next', { sessionId: s.id, taskId: s.current.id })); }
  if (action === 'finish') return run(s.history.length ? '正在整理学习小结与下一步建议…' : '正在结束本轮…', async () => {
    await api('session/finish', { sessionId: s.id }); summaryId = s.id; detailSession = await request(`session/detail?id=${encodeURIComponent(s.id)}`); screen = 'summary';
  });
});
app.addEventListener('input', event => {
  if(event.target.closest('#sync-panel') && event.target.name) syncFields[event.target.name]=event.target.value;
  if (event.target.id === 'answer-text') { draft.answer = event.target.value; persistDraft(); const submit = app.querySelector('[data-action="submit"]'); if (submit) submit.disabled = !draft.answer.trim(); }
  if (event.target.id === 'coach-message') { draft.coachMessage = event.target.value; draft.coachRequestId = null; persistDraft(); const send = app.querySelector('[data-action="send-coach"]'); if (send) send.disabled = !draft.coachMessage.trim(); }
  if (event.target.closest('#settings-form')) settingsDraft = { ...settingsDraft, [event.target.name]: event.target.value };
});
app.addEventListener('change', event => {
  if(event.target.id==='backup-file') {
    const file=event.target.files[0];if(!file)return;
    return run('正在检查备份…',async()=>{if(file.size>20*1024*1024)throw new Error('备份超过 20 MB。');await previewBackup(await file.text());});
  }
  if (event.target.id === 'dashboard-goal') return selectGoal(event.target.value);
  if (event.target.name === 'provider') {
    clearTimeout(codexPolling); clearTimeout(authPoll); authURL = ''; authModels = [];
    settingsDraft = { provider: event.target.value, baseURL: data.providers[event.target.value].baseURL, model: '', apiKey: '' };
    render(); if (settingsDraft.provider === 'codex') refreshCodex();
    if (settingsDraft.provider === 'chatgpt') refreshAuth();
    refreshSync();
  }
  if (event.target.id === 'audio-speed') { speed = Number(event.target.value); if (audioState !== 'idle') playAudio(true); }
});
app.addEventListener('submit', event => {
  if(['sync-config-form','sync-login-form'].includes(event.target.id)) {
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));
    const config=event.target.id==='sync-config-form';
    return run(config?'正在保存同步服务…':'正在验证邮箱…',async()=>{
      await syncAction(config?'configure':'verify',values);syncFields.code='';syncFields.publishableKey='';
      notice=config?'服务设置已保存，请登录同步邮箱。':'邮箱已验证。开启同步前可以先查看数据数量。';
    });
  }
  if (event.target.id === 'chat-composer') { event.preventDefault(); app.querySelector(`[data-action="${isDiscussing(current(), draft) ? 'send-coach' : 'submit'}"]`)?.click(); return; }
  if (event.target.id !== 'settings-form') return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); settingsDraft = values;
  run('正在保存本机配置…', async () => { await api('settings', values); settingsDraft = { ...data.config, apiKey: '' }; notice = '配置已保存。可以测试连接，或回到学习页开始练习。'; });
});
app.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-action][role="link"]');
  if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); card.click(); return; }
  if (!event.target.closest('#chat-composer') || event.target.tagName !== 'TEXTAREA' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault(); app.querySelector(`[data-action="${event.target.id === 'coach-message' ? 'send-coach' : 'submit'}"]`)?.click();
});
app.addEventListener('cancel',event=>{if(event.target.matches('.plan-welcome')){event.preventDefault();app.querySelector('[data-action="plan-notice-close"]')?.click();}},true);
['pointerdown','keydown','input'].forEach(type => document.addEventListener(type, () => { lastActivity = Date.now(); }));
document.addEventListener('visibilitychange', () => { lastActivity = Date.now(); if (document.hidden) { stopMedia(); persistDraft(); } else {if (screen === 'session') render();automaticSync();} });
setInterval(() => {
  if (screen === 'session' && !busy && !document.hidden && current()?.current && !current().feedback && (Date.now() - lastActivity < 60000 || audioState === 'playing' || recognition)) {
    draft.activeSeconds = Math.min(1800, (draft.activeSeconds || 0) + 1); if (draft.activeSeconds % 5 === 0) persistDraft();
  }
}, 1000);
window.addEventListener('online',automaticSync);
window.addEventListener('focus',automaticSync);
setInterval(automaticSync,60000);
window.addEventListener('pagehide', () => { stopMedia(); persistDraft(); });
function updateViewport() { document.documentElement.style.setProperty('--app-height',`${window.visualViewport?.height || window.innerHeight}px`); }
window.visualViewport?.addEventListener('resize',updateViewport);window.addEventListener('resize',updateViewport);updateViewport();
if(native) deviceBridge.safeArea().then(i=>{for(const edge of ['top','bottom','left','right'])document.documentElement.style.setProperty(`--safe-${edge}`,`${i[edge]}px`);}).catch(()=>{});
run('读取学习记录…', async () => { await api('state'); if (current()) { goal = current().goal; screen = 'session'; } }).then(automaticSync);
