import { build } from 'esbuild';
import { mkdir,writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
const out='ios/App/App/NativeResources';
await mkdir(out,{recursive:true});
await build({entryPoints:['src/ios-runtime.js'],outfile:`${out}/study-engine.js`,bundle:true,format:'iife',platform:'browser',target:'safari16',minify:true});
const env={...loadEnv('production',process.cwd()),...process.env};
await writeFile(`${out}/public-config.json`,JSON.stringify({url:env.VITE_SUPABASE_URL || '',publishableKey:env.VITE_SUPABASE_PUBLISHABLE_KEY || ''}));
console.log('SwiftUI headless engine and public sync configuration generated.');
