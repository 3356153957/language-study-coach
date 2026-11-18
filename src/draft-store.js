const prefix='lsc-task-draft-v1:';
const copy=value=>value == null ? value : JSON.parse(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const values=draft=>{if(draft?.questionCount===1)return [draft.answer || ''];try{const value=JSON.parse(draft?.answer || 'null');return Array.isArray(value) ? value : [draft?.answer || ''];}catch{return [draft?.answer || ''];}};
export function createDraftStore(storage) {
  const bases=new Map(),writer=globalThis.crypto.randomUUID();
  let lastResult={kind:'saved'};
  const readRaw=taskId=>{try{const value=JSON.parse(storage.getItem(prefix+taskId) || 'null');return value?.taskId===taskId ? value : null;}catch{return null;}};
  const conflicts=taskId=>{try{const value=JSON.parse(storage.getItem(prefix+'conflicts:'+taskId) || '[]');return Array.isArray(value) ? value : [];}catch{return [];}};
  const preserve=(draft,id=writer)=>{const list=conflicts(draft.taskId).filter(item=>item.writer!==id);list.push({...copy(draft),writer:id,savedAt:Date.now()});storage.setItem(prefix+'conflicts:'+draft.taskId,JSON.stringify(list.slice(-5)));};
  const remember=(taskId,value)=>bases.set(taskId,copy(value));
  return {
    get lastResult(){return lastResult;},
    read(taskId){const value=readRaw(taskId);remember(taskId,value);return copy(value);},
    conflicts,
    write(draft,{force=false}={}){
      if(!draft?.taskId)return true;
      try{
        const base=bases.get(draft.taskId),remote=readRaw(draft.taskId);
        let merged=copy(draft),conflict=false;
        if(force && remote && (!equal(remote.answer,draft.answer) || !equal(remote.coachMessage || '',draft.coachMessage || '')))preserve(remote,'previous-saved');
        if(!force && remote){
          const ours=values(draft),theirs=values(remote),before=values(base),count=Math.max(ours.length,theirs.length);
          const answers=[],skipped=[];
          for(let i=0;i<count;i++){
            const slot=(value,items)=>({answer:items[i] || '',skipped:!!value?.skippedQuestions?.includes(i)});
            const a=slot(draft,ours),b=slot(remote,theirs),old=slot(base,before);
            const value=equal(a,old) ? b : equal(b,old) || equal(a,b) ? a : (conflict=true,a);
            answers.push(value.answer);if(value.skipped)skipped.push(i);
          }
          merged.answer=count>1 ? JSON.stringify(answers):answers[0];merged.skippedQuestions=skipped;
          for(const key of ['coachMessage']){
            if(equal(draft[key] || '',base?.[key] || ''))merged[key]=remote[key] || '';
            else if(!equal(remote[key] || '',base?.[key] || '') && !equal(remote[key] || '',draft[key] || ''))conflict=true;
          }
          for(const key of ['hintUsed','transcriptViewed'])merged[key]=!!draft[key] || !!remote[key];
          for(const key of ['activeSeconds','replays'])merged[key]=Math.max(draft[key] || 0,remote[key] || 0);
        }
        if(conflict){preserve(draft);lastResult={kind:'conflict',draft:copy(draft),remote};return false;}
        const mergedOther=!equal(merged.answer,draft.answer) || !equal(merged.coachMessage || '',draft.coachMessage || '');
        const saved={...merged,savedAt:Date.now()};storage.setItem(prefix+draft.taskId,JSON.stringify(saved));remember(draft.taskId,saved);
        if(force)storage.setItem(prefix+'conflicts:'+draft.taskId,JSON.stringify(conflicts(draft.taskId).filter(item=>item.writer!==writer)));
        lastResult={kind:mergedOther ? 'merged':'saved',draft:copy(saved)};return true;
      }catch{lastResult={kind:'unavailable'};return false;}
    },
    remove(taskId){try{if(taskId){storage.removeItem(prefix+taskId);storage.removeItem(prefix+'conflicts:'+taskId);bases.delete(taskId);}}catch{/* Keep the in-memory draft usable. */}},
  };
}
