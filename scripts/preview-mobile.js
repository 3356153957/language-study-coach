// Local mobile regression fixture. No real accounts, email or model requests.
import { createServer } from 'vite';
import { createAPI } from '../server/api.js';
import { prompts, skills } from '../server/coach.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory=await mkdtemp(path.join(tmpdir(),'lsc-mobile-qa-'));
const single={kind:'text',skill:'表达',level:'A2',prompt:'Describe how you prepared the table before dinner.',passage:'',audio:'',options:[],answer:'I had put the plates on the table.',hint:'想想已经准备好的东西。',reason:'隔离样例：测试手机输入与反馈。'};
const multi={...single,id:'qa-multi',prompt:'Tell me about your dinner plans.',questions:[{prompt:'What did you prepare before dinner?',options:[],answer:'I had put the plates on the table.'},{prompt:'What would you like to cook?',options:[],answer:'I would like to cook rice.'}]};
await writeFile(path.join(directory,'state.json'),JSON.stringify({version:1,config:{provider:'compatible',baseURL:'https://fixture.invalid/v1',model:'fixture',apiKey:'test-only'},profiles:{},sessions:[{id:'qa-mobile',goal:'四级',mode:'写作',placement:false,targetCount:5,startedAt:new Date().toISOString(),currentAskedAt:new Date().toISOString(),current:multi,history:[],feedback:null}]}));
const api=await createAPI({directory,codex:{status:async()=>({loggedIn:false}),close(){}},modelCall:async(config,system,context)=>{
  if(system===prompts.gradeAndNext) return {feedback:{correct:true,explanation:'隔离验收：两句回答均已收到。',suggestion:'I had put the plates on the table. I would like to cook rice.',weakness:''},nextTask:single};
  if(system===prompts.reply) return {reply:'隔离验收：你想说的是提前把盘子摆在餐桌上。'};
  if(system===prompts.report) return {level:'A2',summary:'隔离验收：已完成本轮。',nextFocus:'继续练习表达。',skills:skills.map(name=>({name,level:'A2',evidence:'隔离练习样例。'}))};
  if(context?.mode==='听力') return {kind:'listening',skill:'听力',level:'A2',prompt:'Where is the plate?',passage:'',audio:'The plate is on the kitchen table.',options:['On the kitchen table.','On the desk.'],answer:'On the kitchen table.',hint:'注意地点。',reason:'隔离听力控件验收。'};
  if(context?.mode==='阅读') return {kind:'choice',skill:'阅读',level:'A2',prompt:'Where is the plate?',passage:'Alex put the plate on the kitchen table before dinner.',translation:'亚历克斯在晚餐前把盘子放在厨房的桌子上。',audio:'',options:['On the kitchen table.','On the desk.'],answer:'On the kitchen table.',hint:'注意地点。',reason:'隔离阅读验收。'};
  return single;
},syncOptions:{schedule:false,defaultConfig:{url:'https://fixture.supabase.co',publishableKey:'sb_publishable_qa_only_public_key'},authFactory:()=>({auth:{signInWithOtp:async()=>({error:null}),verifyOtp:async({token})=>token==='123456'?{data:{session:{access_token:'qa-only',refresh_token:'qa-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'qa-only',email:'qa@example.com'}}}}:{error:{status:400}}}})}});
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[{name:'mobile-qa',configureServer(s){s.middlewares.use(api);},transformIndexHtml(){return [{tag:'style',children:':root{--safe-top:62px;--safe-bottom:34px}',injectTo:'head'},{tag:'div',attrs:{style:'position:fixed;top:8px;right:12px;z-index:99;font:10px sans-serif;background:#fff1ce'},children:'隔离验收 · 模拟安全区',injectTo:'body'}];}}],server:{host:'127.0.0.1',port:5174,strictPort:true,fs:{deny:['**/.local/**','.env','.env.*']}}});
await vite.listen();console.log('Mobile QA: http://127.0.0.1:5174/; fake OTP: 123456');
async function close(){api.close();await vite.close();process.exit();}
process.once('SIGINT',close);process.once('SIGTERM',close);
