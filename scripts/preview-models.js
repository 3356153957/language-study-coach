// Isolated acceptance page with a local, simulated upstream. No real API keys.
import { createServer as createVite } from 'vite';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAPI } from '../server/api.js';

const directory = await mkdtemp(path.join(tmpdir(), 'lsc-model-picker-qa-'));
const key = 'qa-only-not-a-real-key';
const baseURL = 'http://127.0.0.1:5191/v1';
const models = [{id:'qa-balanced',name:'Tutor Balanced'},{id:'qa-fast',name:'Tutor Fast'},
  ...Array.from({length:10},(_,i)=>({id:`qa-practice-${i+1}`,name:`Practice ${i+1}`}))];
const upstream = createServer(async (req,res) => {
  if (req.url.startsWith('/slow/')) await new Promise(resolve=>setTimeout(resolve,1800));
  res.writeHead(req.url.startsWith('/denied/') ? 401 : 200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(req.url.startsWith('/denied/') ? {error:'Private upstream detail must not appear in the app'} : {
    data:req.headers.authorization === 'Bearer qa-rotated' ? [{id:'qa-rotated-model',name:'Rotated Key Model'}] : models}));
});
await new Promise(resolve=>upstream.listen(5191,'127.0.0.1',resolve));
await writeFile(path.join(directory,'state.json'),JSON.stringify({version:1,config:{provider:'compatible',baseURL,model:'',apiKey:key},profiles:{},sessions:[]}));
const api = await createAPI({directory,codex:{status:async()=>({installed:false,loggedIn:false}),close(){}},modelCall:async()=>({ok:true})});
const vite = await createVite({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-model-picker-qa',
  plugins:[{name:'model-picker-qa',configureServer(s){s.middlewares.use(api);},transformIndexHtml(){return [{tag:'div',attrs:{style:'position:fixed;top:4px;right:8px;z-index:999;font:11px sans-serif;background:#fff1ce;padding:4px 8px;border-radius:6px'},children:'隔离验收 · 模拟上游',injectTo:'body'}];}}],
  server:{host:'127.0.0.1',port:5190,strictPort:true,fs:{deny:['**/.local/**','.env','.env.*']}}});
await vite.listen();
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/model-picker-qa.json',JSON.stringify({directory,url:'http://127.0.0.1:5190/',upstream:baseURL,key,realModelRequests:false},null,2));
console.log(`Model picker QA: http://127.0.0.1:5190/ (mock upstream, test key: ${key})`);
async function close(){api.close();await vite.close();await new Promise(resolve=>upstream.close(resolve));process.exit();}
process.once('SIGINT',close);process.once('SIGTERM',close);
