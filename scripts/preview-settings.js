// Settings acceptance fixture: no learner data and no real inference calls.
import { createServer } from 'vite';
import { createAPI } from '../server/api.js';
import { mkdtemp,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportBackup } from '../server/backup.js';
const directory=await mkdtemp(path.join(tmpdir(),'lsc-settings-qa-'));
const task={id:'qa-task',kind:'choice',skill:'语法',level:'A2',prompt:'Yesterday I ___ to school.',passage:'',audio:'',options:['went','go'],answer:'went',hint:'注意 yesterday',reason:'隔离验收'};
const at=new Date().toISOString();
const round={id:'qa-round',goal:'四级',mode:'综合',targetCount:5,startedAt:at,finishedAt:at,current:null,feedback:null,history:[{id:'qa-answer',task,answer:'went',feedback:{correct:true,explanation:'过去式',suggestion:'',weakness:''},at,askedAt:at,activeSeconds:20}]};
await writeFile(path.join(directory,'state.json'),JSON.stringify({version:1,config:null,sessions:[round],profiles:{}}));
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/import-qa.json',JSON.stringify(exportBackup({sessions:[{...round,id:'qa-new',history:[{...round.history[0],id:'qa-new-answer',task:{...task,id:'qa-new-task'}}]}]})));
// Isolated cloud fixture: no external auth, emails, uploads or real credentials.
let revision=1;
const cloud=new Map([['round:qa-cloud',{kind:'round',id:'qa-cloud',payload:exportBackup({sessions:[{...round,id:'qa-cloud'}]}).data.sessions[0],revision}]]);
const api=await createAPI({directory,modelCall:async()=>{throw new Error('No AI calls in settings QA');},
  codex:{status:async()=>({loggedIn:false,accounts:[]}),close(){}},
  syncOptions:{schedule:false,defaultConfig:{url:'https://testproject.supabase.co',publishableKey:'sb_publishable_qa_only_public_key'},authFactory:()=>({auth:{signInWithOtp:async()=>({error:null}),verifyOtp:async()=>({data:{session:{access_token:'qa-only-access',refresh_token:'qa-only-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'qa-user',email:'qa@example.com'}}}})}}),
    transport:async(url,o)=>{
      if(o.method==='HEAD')return new Response(null,{headers:{'content-range':`0-0/${cloud.size}`}});
      if(url.includes('/rpc/')) {
        const b=JSON.parse(o.body),key=`${b.p_kind}:${b.p_id}`,old=cloud.get(key);
        if((old?.revision || 0)!==b.p_expected)return Response.json({applied:false,record:old});
        const record={kind:b.p_kind,id:b.p_id,payload:b.p_payload,revision:++revision};cloud.set(key,record);return Response.json({applied:true,record});
      }
      const after=Number(new URL(url).searchParams.get('revision').slice(3));
      return Response.json([...cloud.values()].filter(r=>r.revision>after).sort((a,b)=>a.revision-b.revision).slice(0,25));
    }}});
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[{name:'settings-qa',configureServer(s){s.middlewares.use(api);},
 transformIndexHtml(){return [{tag:'style',children:'html:root{--safe-top:62px;--safe-bottom:34px}',injectTo:'head'},{tag:'div',attrs:{style:'position:fixed;top:5px;right:10px;z-index:99;font:10px sans-serif;background:#fff1ce'},children:'隔离验收 · 模拟安全区域',injectTo:'body'}];}
}],server:{host:'127.0.0.1',port:5183,strictPort:true,fs:{deny:['**/.local/**','.env','.env.*']}}});
await vite.listen();console.log('Settings QA: http://127.0.0.1:5183/');
async function close(){api.close();await vite.close();process.exit();}process.once('SIGINT',close);process.once('SIGTERM',close);
