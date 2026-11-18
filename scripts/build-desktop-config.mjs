import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { validateSyncConfig } from '../server/cloud-sync.js';

const env = {...loadEnv('production', process.cwd()), ...process.env};
let values = {url:env.VITE_SUPABASE_URL, publishableKey:env.VITE_SUPABASE_PUBLISHABLE_KEY};
if (!values.url || !values.publishableKey) {
  try {
    const local = JSON.parse(await readFile('ios/App/App/NativeResources/public-config.json', 'utf8'));
    values = {url:values.url || local.url, publishableKey:values.publishableKey || local.publishableKey};
  } catch { /* The desktop build remains usable offline without sync configuration. */ }
}
const sync = values.url && values.publishableKey ? validateSyncConfig(values) : {};
const turnstileSiteKey = String(env.VITE_TURNSTILE_SITE_KEY || '').trim();
await mkdir('desktop', {recursive:true});
await writeFile('desktop/public-config.json', JSON.stringify({...sync, ...(turnstileSiteKey ? {turnstileSiteKey} : {})}));
console.log(`Desktop public configuration generated (sync=${Boolean(sync.url)}, captcha=${Boolean(turnstileSiteKey)}).`);
