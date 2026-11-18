import { mergeWordMarks } from './vocabulary.js';
import { mergeAssessments } from './exam-assessment.js';
import { validateBackup } from './backup.js';
import { AppError } from './providers.js';
import { sharedProfile } from './profile.js';
import { preserveLearningPlans } from './learning-plan.js';
import { mergeRoundReport } from './report-history.js';

export const recordKey = r => `${r.kind}:${r.id}`;
export function canonical(value) {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function recordsFromBackup(backup) {
  const d=validateBackup(backup);
  return [...d.sessions.map(payload=>({kind:'round',id:payload.id,payload})),
    ...(d.profile?[{kind:'profile',id:'learner',payload:d.profile}]:[]),
    ...d.backgrounds.map(payload=>({kind:'background',id:`${payload.source.threadId}:${payload.goal}`,payload}))];
}
export function validateRecord(r) {
  if(!r || typeof r.id!=='string' || r.id.length>160 || !['round','profile','background'].includes(r.kind)) throw new AppError('云端记录格式无效，本机记录未覆盖。');
  const data={sessions:[],profile:null,backgrounds:[]};
  if(r.kind==='round') data.sessions=[r.payload];
  if(r.kind==='profile') data.profile=r.payload;
  if(r.kind==='background') data.backgrounds=[r.payload];
  const result=recordsFromBackup({format:'language-study-coach',version:1,data});
  if(result.length!==1 || result[0].id!==r.id) throw new AppError('云端记录标识不一致，本机记录未覆盖。');
  return result[0];
}

// Divergent answers require review; a device clock cannot resolve them.
export function reconcile(local,remote) {
  if(!local) return remote;
  if(!remote) return local;
  if(canonical(local.payload)===canonical(remote.payload)) return local;
  const a=local.payload,b=remote.payload;
  if(local.kind==='profile') {
    const chosen=(a.updatedAt || '') >= (b.updatedAt || '') ? local : remote;
    return {...chosen,payload:preserveLearningPlans(chosen.payload,chosen===local ? b : a)};
  }
  if(local.kind==='background') return (a.importedAt || '') >= (b.importedAt || '') ? local : remote;
  if(a.goal!==b.goal || a.mode!==b.mode || a.startedAt!==b.startedAt) return null;
  const shorter=a.history.length<=b.history.length?a.history:b.history,longer=shorter===a.history?b.history:a.history;
  if(!shorter.every((e,i)=>canonical(e)===canonical(longer[i]))) return null;
  // Keep the exercise being answered on its original device. Concurrent edits
  // of a manually copied active round need review instead of silent overwrite.
  if(!a.finishedAt && canonical({...a,discussions:null,wordMarks:null,examAssessments:null})!==canonical({...b,discussions:null,wordMarks:null,examAssessments:null})) return null;
  if(a.finishedAt && !b.finishedAt && b.history.length>a.history.length) return null;
  const chosen=a.history.length>b.history.length?local:b.history.length>a.history.length?remote:a.finishedAt?local:remote;
  const discussions={};
  for(const source of [a.discussions || {},b.discussions || {}]) for(const [taskId,turns] of Object.entries(source)) {
    const map=new Map((discussions[taskId] || []).map(t=>[t.id,t]));
    for(const t of turns) {if(map.has(t.id) && canonical(map.get(t.id))!==canonical(t)) return null;map.set(t.id,t);}
    discussions[taskId]=[...map.values()].sort((x,y)=>x.at.localeCompare(y.at)||x.id.localeCompare(y.id));
  }
  const payload=a.history.length===b.history.length ? mergeRoundReport(chosen.payload,chosen===local ? b : a) : chosen.payload;
  const wordMarks=mergeWordMarks(a.wordMarks,b.wordMarks),examAssessments=mergeAssessments(a.examAssessments,b.examAssessments);
  return validateRecord({...chosen,payload:{...payload,discussions,...(wordMarks.length?{wordMarks}:{}),...(examAssessments.length?{examAssessments}:{})}});
}

export function mergeCloudRecords(state,records) {
  const sessions=state.sessions.slice(),positions=new Map(sessions.map((s,i)=>[s.id,i]));
  let profile=sharedProfile(state),backgrounds=[...(state.backgrounds || [])];
  for(const raw of records) {
    const r=validateRecord(raw);
    if(r.kind==='round') {
      if(!r.payload.finishedAt) continue; // Other devices' current rounds stay separate.
      const index=positions.get(r.id);
      if(index===undefined){positions.set(r.id,sessions.length);sessions.push(r.payload);}
      else if(sessions[index].finishedAt) {
        const merged=reconcile(validateRecord({kind:'round',id:r.id,payload:sessions[index]}),r);
        if(merged) sessions[index]=merged.payload;
      }
    } else if(r.kind==='profile') {
      const chosen=!profile || (r.payload.updatedAt || '')>(profile.updatedAt || '') ? r.payload : profile;
      profile=preserveLearningPlans(chosen,chosen===profile ? r.payload : profile);
    } else {
      const index=backgrounds.findIndex(b=>`${b.source.threadId}:${b.goal}`===r.id);
      if(index<0)backgrounds.push(r.payload);
      else if(r.payload.importedAt>backgrounds[index].importedAt)backgrounds[index]=r.payload;
    }
  }
  sessions.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  return {...state,sessions,profile,backgrounds};
}
