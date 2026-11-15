import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createAPI } from './server/api.js';

async function attachAPI(server) {
  const env=server.config.env;
  const api = await createAPI({ directory: fileURLToPath(new URL('./.local/', import.meta.url)),syncOptions:{
    defaultConfig:env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY ? {url:env.VITE_SUPABASE_URL,publishableKey:env.VITE_SUPABASE_PUBLISHABLE_KEY}:undefined,
  } });
  server.middlewares.use(api);
  server.httpServer?.once('close', api.close);
}

export default defineConfig({
  plugins: [{
    name: 'local-coach-api',
    configureServer: attachAPI,
    configurePreviewServer: attachAPI,
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { deny: ['.local/**', '**/.local/**', '.env', '.env.*', '*.{crt,pem}'] } },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
