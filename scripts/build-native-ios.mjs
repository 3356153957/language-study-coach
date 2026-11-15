import { build } from 'esbuild';
import { mkdir,writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { validateSyncConfig } from '../server/cloud-sync.js';
const out='ios/App/App/NativeResources';
const env={...loadEnv('production',process.cwd()),...process.env};
const config=env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY
  ? validateSyncConfig({url:env.VITE_SUPABASE_URL,publishableKey:env.VITE_SUPABASE_PUBLISHABLE_KEY}):{};
await mkdir(out,{recursive:true});
await build({entryPoints:['src/ios-runtime.js'],outfile:`${out}/study-engine.js`,bundle:true,format:'iife',platform:'browser',target:'safari16',minify:true});
await writeFile(`${out}/public-config.json`,JSON.stringify(config));
console.log('SwiftUI headless engine and public sync configuration generated.');
