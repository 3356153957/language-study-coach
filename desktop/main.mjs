import { app, BrowserWindow, session, shell } from 'electron';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAPI } from '../server/api.js';
import { validateSyncConfig } from '../server/cloud-sync.js';
import { createDesktopServer } from './static-server.mjs';
import { portCandidates, readSavedPort, savePort } from './port.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const isLocal = value => { try { const u = new URL(value); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); } catch { return false; } };
const isTrustedExternal = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['auth.openai.com', 'chatgpt.com', 'auth0.openai.com', 'github.com', 'www.github.com'].includes(u.hostname); } catch { return false; } };

let mainWindow, localServer, api, quitting = false;

async function loadPublicConfig() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'desktop', 'public-config.json')
    : path.join(here, 'public-config.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    const sync = value?.url && value?.publishableKey
      ? validateSyncConfig({url:value.url,publishableKey:value.publishableKey})
      : undefined;
    return {sync,turnstileSiteKey:String(value?.turnstileSiteKey || '')};
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('Desktop public configuration unavailable:', error.message);
    return {sync:undefined,turnstileSiteKey:''};
  }
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 960, minHeight: 680,
    title: 'Language Study Coach', backgroundColor: '#f7f7f2',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (isTrustedExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

async function start() {
  const staticRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'dist') : path.join(here, '..', 'dist');
  await access(path.join(staticRoot, 'index.html'));
  const dataDirectory = path.join(app.getPath('userData'), 'data');
  const publicConfig = await loadPublicConfig();
  api = await createAPI({ directory: dataDirectory, syncOptions: {
    defaultConfig: publicConfig.sync,
    turnstileSiteKey: publicConfig.turnstileSiteKey,
  } });
  localServer = createDesktopServer({ api, staticRoot, onAuthCallback: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } } });
  const portFile = path.join(app.getPath('userData'), 'desktop-port.json');
  const saved = await readSavedPort(portFile);
  const port = await localServer.listen(portCandidates(saved));
  // Remember only the first port. A temporary conflict borrows the next port for
  // this launch without abandoning the origin that holds the existing drafts.
  if (saved === null) await savePort(portFile, port).catch(error => console.warn('Desktop port not saved:', error.message));
  await createWindow(port);
}

async function stop() {
  if (quitting) return;
  quitting = true;
  try { api?.close(); } finally { await localServer?.close().catch(() => {}); }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(permission === 'media' && isLocal(webContents.getURL())));
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => permission === 'media' && isLocal(requestingOrigin || webContents?.getURL() || ''));
    await start();
    app.on('activate', () => { if (!mainWindow) start().catch(error => { console.error(error); app.quit(); }); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('before-quit', () => { stop(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
