import { AppError } from './providers.js';
import { goals, modes, validateTask, validateReport, validateFeedback, validateLearnerAnswer } from './coach.js';
import { validateBackground } from './background.js';
import { sharedProfile } from './profile.js';

export const backupLimit = 20 * 1024 * 1024;
const fail = () => { throw new AppError('备份文件格式无效或内容不完整，原记录未修改。'); };
const id = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(v) ? v : fail();
const text = (v,max=6000) => typeof v === 'string' && v.length<=max ? v : fail();
const date = v => typeof v==='string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fail();
const integer = (v,max) => Number.isInteger(v) && v>=0 && v<=max ? v : fail();
const flag = v => typeof v==='boolean' ? v : fail();
function task(t, mode) { return { ...validateTask(t,{mode,history:[]}),id:id(t.id) }; }
function report(r) { return r ? {...validateReport(r),...(r.updatedAt?{updatedAt:date(r.updatedAt)}:{})} : null; }
function session(s) {
  if (!s || !goals.includes(s.goal) || !modes.includes(s.mode) || !Array.isArray(s.history) || s.history.length>100) fail();
  const h=s.history.map(e=>{
    const t=task(e.task,s.mode),answer=text(e.answer,t.questions?.length>1?100000:4000);
    validateLearnerAnswer(t,answer);
    return {id:id(e.id),task:t,answer,feedback:validateFeedback(e.feedback,t,answer),at:date(e.at),askedAt:date(e.askedAt || s.startedAt),
      activeSeconds:integer(e.activeSeconds || 0,1800),replays:integer(e.replays || 0,100),hintUsed:flag(e.hintUsed || false),transcriptViewed:flag(e.transcriptViewed || false)};
  });
  if(new Set(h.map(e=>e.id)).size!==h.length || new Set(h.map(e=>e.task.id)).size!==h.length) fail();
  const result={id:id(s.id),goal:s.goal,mode:s.mode,placement:!!s.placement,targetCount:integer(s.targetCount,100),startedAt:date(s.startedAt),history:h,
    finishedAt:s.finishedAt?date(s.finishedAt):null,report:report(s.report),current:s.current?task(s.current,s.mode):null,feedback:null,prepared:null};
  if(result.targetCount<1 || h.length>result.targetCount || (!result.finishedAt && !result.current)) fail();
  if(result.finishedAt) { result.current=null; }
  else {
    result.currentAskedAt=date(s.currentAskedAt || s.startedAt);
    result.currentHelpUsed=!!s.currentHelpUsed;
    const answered=h.find(e=>e.task.id===result.current.id);
    if(s.feedback) { if(answered!==h.at(-1) || JSON.stringify(answered.task)!==JSON.stringify(result.current)) fail(); result.feedback=answered.feedback; }
    else if(answered) fail();
    if(s.prepared) { if(!result.feedback) fail(); result.prepared={task:task(s.prepared.task,s.mode)}; }
  }
  const ids=new Set([...h.map(e=>e.task.id),...(result.current?[result.current.id]:[])]);
  if(s.discussions) {
    result.discussions=Object.fromEntries(Object.entries(s.discussions).map(([key,turns])=>{
      if(!ids.has(key) || !Array.isArray(turns) || turns.length>30) fail();
      return [key,turns.map(t=>({id:id(t.id),message:text(t.message,2000),reply:text(t.reply,6000),at:date(t.at)}))];
    }));
  }
  return result;
}

export function validateBackup(input,{local=false}={}) {
  try {
    if(!input || input.format!=='language-study-coach' || input.version!==1 || !input.data || !Array.isArray(input.data.sessions) || (!local && (input.data.sessions.length>10000 || JSON.stringify(input).length>backupLimit))) fail();
    const sessions=input.data.sessions.map(session);
    if(new Set(sessions.map(s=>s.id)).size!==sessions.length || sessions.filter(s=>!s.finishedAt).length>1) fail();
    const backgrounds=(input.data.backgrounds || []).map(b=>({...validateBackground(b),importedAt:date(b.importedAt)}));
    if(backgrounds.length>100) fail();
    return {sessions,profile:report(input.data.profile),backgrounds};
  } catch { fail(); }
}

export function validateStoredLearningState(state){
  if(!state || state.version!==1 || (state.profiles && (typeof state.profiles!=='object' || Array.isArray(state.profiles))))fail();
  validateBackup({format:'language-study-coach',version:1,data:{sessions:state.sessions,profile:sharedProfile(state),backgrounds:state.backgrounds || []}},{local:true});
  return state;
}

export function exportBackup(state) {
  // Whitelist through the same decoder. Provider keys and OAuth credentials are
  // deliberately outside the portable schema, including nested source fields.
  const portable=validateBackup({format:'language-study-coach',version:1,data:{sessions:state.sessions,profile:sharedProfile(state),backgrounds:state.backgrounds || []}});
  return {format:'language-study-coach',version:1,exportedAt:new Date().toISOString(),data:portable};
}

export function planImport(state,input) {
  const incoming=validateBackup(input),sessions=state.sessions.slice(),existing=new Map(sessions.map((s,i)=>[s.id,i]));
  let added=0,skipped=0,updated=0,conflicts=0;
  let active=sessions.find(s=>!s.finishedAt);
  for(const s of incoming.sessions) {
    if(existing.has(s.id)) {
      const i=existing.get(s.id),local=sessions[i];
      // Merge newer, completed copies only if the saved answer prefix agrees.
      const prefix=local.history.every((h,j)=>s.history[j]?.id===h.id && s.history[j]?.answer===h.answer);
      if(s.finishedAt && s.history.length>local.history.length && prefix && local.finishedAt) {sessions[i]=s;updated++;}
      else {skipped++;if(!prefix)conflicts++;}
      continue;
    }
    if(!s.finishedAt && active) {skipped++;conflicts++;continue;}
    sessions.push(s);existing.set(s.id,sessions.length-1);if(!s.finishedAt)active=s;added++;
  }
  sessions.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const currentProfile=sharedProfile(state),candidate=incoming.profile;
  // A duplicate/stale import cannot replace the current capability profile.
  const profile=(added || updated) && candidate && (!currentProfile || (candidate.updatedAt || '')>(currentProfile.updatedAt || '')) ? candidate : currentProfile;
  const backgrounds=[...(state.backgrounds || [])];
  for(const b of incoming.backgrounds) if(!backgrounds.some(x=>x.source.threadId===b.source.threadId && x.goal===b.goal)) backgrounds.push(b);
  return { state:{...state,sessions,profile,backgrounds},summary:{rounds:incoming.sessions.length,answers:incoming.sessions.reduce((n,s)=>n+s.history.length,0),added,updated,skipped,conflicts} };
}
