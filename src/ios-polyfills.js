// Small host adapters for JavaScriptCore, deliberately without browser objects.
let requestSequence=0;
const pending=new Map();
globalThis.nativeInvoke=(action,input={},signal)=>new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const id=String(++requestSequence);
  const cancel=()=>{if(!pending.delete(id))return;signal.removeEventListener('abort',cancel);__nativeCancel(id);reject(signal.reason);};
  const cleanup=()=>signal?.removeEventListener('abort',cancel);
  pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});
  signal?.addEventListener('abort',cancel);
  try{__nativeInvoke(id,action,JSON.stringify(input));}catch(error){pending.delete(id);cleanup();reject(error);}
});
globalThis.nativeDeliver=(id,json,error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);if(error)item.reject(new Error(error));else{try{item.resolve(JSON.parse(json));}catch(e){item.reject(e);}}};
globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value));
globalThis.setTimeout=(callback,ms=0,...args)=>__nativeTimer(()=>callback(...args),Math.max(0,ms));
globalThis.clearTimeout=id=>__nativeClearTimer(id);
globalThis.setInterval=(callback,ms)=>{const id={};const tick=()=>{callback();if(!id.stopped)id.timer=setTimeout(tick,ms);};id.timer=setTimeout(tick,ms);return id;};
globalThis.clearInterval=id=>{id.stopped=true;clearTimeout(id.timer);};
globalThis.atob=value=>__nativeBase64(String(value),false);
globalThis.btoa=value=>__nativeBase64(String(value),true);
globalThis.TextEncoder=class {
  encode(value=''){
    const bytes=[];
    for(const char of String(value)){
      let point=char.codePointAt(0);if(point>=0xd800 && point<=0xdfff)point=0xfffd;
      if(point<0x80)bytes.push(point);
      else if(point<0x800)bytes.push(0xc0|(point>>6),0x80|(point&63));
      else if(point<0x10000)bytes.push(0xe0|(point>>12),0x80|((point>>6)&63),0x80|(point&63));
      else bytes.push(0xf0|(point>>18),0x80|((point>>12)&63),0x80|((point>>6)&63),0x80|(point&63));
    }
    return Uint8Array.from(bytes);
  }
};
globalThis.TextDecoder=class {decode(value){return value?decodeURIComponent(escape(String.fromCharCode(...new Uint8Array(value)))):'';}};
globalThis.crypto={randomUUID:()=>__nativeUUID(),getRandomValues:target=>{
  if(!ArrayBuffer.isView(target) || !/^\[object (?:U?Int(?:8|16|32)|Uint8Clamped|BigInt64|BigUint64)Array\]$/i.test(Object.prototype.toString.call(target)))throw new TypeError('需要整数类型数组。');
  if(target.byteLength>65536)throw new Error('随机数请求超过上限。');
  const bytes=JSON.parse(__nativeRandom(target.byteLength));
  if(!Array.isArray(bytes) || bytes.length!==target.byteLength)throw new Error('无法安全生成授权随机数，请重试。');
  new Uint8Array(target.buffer,target.byteOffset,target.byteLength).set(bytes);return target;
},subtle:{digest:async(algorithm,value)=>Uint8Array.from(JSON.parse(__nativeSHA256(JSON.stringify([...new Uint8Array(value)])))).buffer}};
globalThis.AbortSignal=class {
  constructor(){this._aborted=false;this.listeners=[];}
  static timeout(ms){const s=new AbortSignal();s.timeout=ms;s.deadline=Date.now()+ms;return s;}
  get aborted(){if(!this._aborted && this.deadline!==undefined && Date.now()>=this.deadline)this.abort(Object.assign(new Error('请求超时，请重试。'),{name:'TimeoutError'}));return this._aborted;}
  abort(reason){if(this._aborted)return;this._aborted=true;this.reason=reason;clearTimeout(this.timer);for(const callback of this.listeners.slice())callback();}
  addEventListener(name,callback){if(name!=='abort')return;this.listeners.push(callback);if(!this._aborted && this.deadline!==undefined && !this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.aborted;},Math.max(0,this.deadline-Date.now()));}
  removeEventListener(name,callback){if(name!=='abort')return;this.listeners=this.listeners.filter(x=>x!==callback);if(!this.listeners.length){clearTimeout(this.timer);this.timer=null;}}
  throwIfAborted(){if(this.aborted)throw this.reason;}
};
globalThis.AbortController=class {constructor(){this.signal=new AbortSignal();}abort(reason){this.signal.abort(reason ?? Object.assign(new Error('请求已取消。'),{name:'AbortError'}));}};
globalThis.Headers=class {
  constructor(input={}){this.map=new Map();for(const [k,v] of input instanceof Headers?input.entries():Array.isArray(input)?input:Object.entries(input))this.set(k,v);}
  set(k,v){this.map.set(k.toLowerCase(),String(v));}get(k){return this.map.get(k.toLowerCase())??null;}has(k){return this.map.has(k.toLowerCase());}
  entries(){return this.map.entries();}[Symbol.iterator](){return this.entries();}
};
globalThis.Response=class {
  constructor(body='',options={}){this.value=body??'';this.status=options.status??200;this.ok=this.status>=200&&this.status<300;this.headers=new Headers(options.headers);}
  async text(){return this.value;}async json(){return JSON.parse(this.value);}clone(){return new Response(this.value,{status:this.status,headers:this.headers});}
  static json(value,options={}){return new Response(JSON.stringify(value),options);}
};
globalThis.URLSearchParams=class {
  constructor(input=''){this.rows=[];if(typeof input==='string'){for(const item of input.replace(/^\?/,'').split('&').filter(Boolean)){const [key,...value]=item.split('=');this.rows.push([decodeURIComponent(key.replace(/\+/g,' ')),decodeURIComponent(value.join('=').replace(/\+/g,' '))]);}}else{this.rows=Array.isArray(input)?input.map(x=>x.slice()):Object.entries(input).map(([k,v])=>[k,String(v)]);}}
  get(key){return this.rows.find(x=>x[0]===key)?.[1]??null;}has(key){return this.rows.some(x=>x[0]===key);}set(key,value){const i=this.rows.findIndex(x=>x[0]===key);this.delete(key);this.rows.splice(i<0?this.rows.length:i,0,[key,String(value)]);this.change?.();}
  append(key,value){this.rows.push([key,String(value)]);this.change?.();}delete(key){this.rows=this.rows.filter(x=>x[0]!==key);this.change?.();}
  toString(){return this.rows.map(x=>x.map(v=>encodeURIComponent(v).replace(/%20/g,'+')).join('=')).join('&');}entries(){return this.rows[Symbol.iterator]();}[Symbol.iterator](){return this.entries();}
};
globalThis.URL=class {
  constructor(value,base){this.parts=JSON.parse(__nativeURL(String(value),base?String(base):''));if(this.parts.error)throw new Error('Invalid URL');const prefix=this.parts.href.split(/[?#]/)[0];this.searchParams=new URLSearchParams(this.parts.search);this.searchParams.change=()=>{const s=this.searchParams.toString();this.parts.search=s?'?'+s:'';this.parts.href=prefix+this.parts.search+this.parts.hash;};}
  get href(){return this.parts.href;}get origin(){return this.parts.origin;}get protocol(){return this.parts.protocol;}get hostname(){return this.parts.hostname;}get port(){return this.parts.port;}get username(){return this.parts.username;}get password(){return this.parts.password;}get pathname(){return this.parts.pathname;}get search(){return this.parts.search;}get hash(){return this.parts.hash;}toString(){return this.href;}
};
globalThis.fetch=async(url,options={})=>{
  const response=await nativeInvoke('http',{url:String(url),method:options.method || 'GET',headers:Object.fromEntries(new Headers(options.headers)),body:options.body,timeout:options.signal?.deadline ? Math.max(1,options.signal.deadline-Date.now()):60000},options.signal);
  options.signal?.throwIfAborted();
  return new Response(response.body,{status:response.status,headers:response.headers});
};
