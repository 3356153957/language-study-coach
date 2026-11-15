import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { createEngine } from '../server/engine.js';
import { AppError, providers, callModel } from '../server/providers.js';

const storage = registerPlugin('StudyStorage');
export const mobileProviders = Object.fromEntries(Object.entries(providers).filter(([key]) => key !== 'codex'));

export function nativeFetcher(http = CapacitorHttp) {
  return async (url, options) => {
    const result = await http.request({ url, method: options.method, headers: options.headers,
      data: JSON.parse(options.body), responseType: 'json', connectTimeout: 15000, readTimeout: 60000, disableRedirects: true });
    return { ok: result.status >= 200 && result.status < 300, status: result.status,
      json: async () => typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
  };
}

export async function createNativeClient({ store = storage, compact = false, timeZone = 'UTC', modelCall = (config, system, context) => callModel(config, system, context, nativeFetcher()) } = {}) {
  let initialState;
  try {
    const { value } = await store.load();
    if (value) {
      initialState = JSON.parse(value);
      if (initialState.version !== 1 || !Array.isArray(initialState.sessions)) throw new Error();
    }
  } catch { throw new AppError('手机学习记录无法读取。请重新打开应用；不要卸载，以免丢失记录。'); }
  const engine = createEngine({ initialState, modelCall, availableProviders: mobileProviders, allowImport: false,
    save: async state => {
      try { await store.save({ value: JSON.stringify(state) }); }
      catch { throw new AppError('手机存储失败，原有记录未覆盖，请检查可用空间后重试。'); }
    } });
  return { async request(path, body) {
    const url = new URL(path, 'https://local/'); path = url.pathname.slice(1);
    if (path === 'state' && body === undefined) return engine.view({ compact, timeZone });
    if (path === 'profile' && body === undefined) return engine.profile();
    if (path === 'activity' && body === undefined) return engine.activity(url.searchParams.get('offset'));
    if (path === 'session/detail' && body === undefined) return engine.detail(url.searchParams.get('id'));
    if (path === 'review' && body === undefined) return engine.review(url.searchParams.get('goal'), url.searchParams.get('offset'));
    if (path.startsWith('codex/') || path === 'background/import') throw new AppError('手机独立版不提供此功能。', 404);
    if (path === 'session/start' && body?.placement) throw new AppError('请从日常练习开始。');
    if (path === 'settings' && !String(body?.baseURL || mobileProviders[body?.provider]?.baseURL || '').startsWith('https://')) throw new AppError('手机 API 地址须使用 HTTPS。');
    return engine.execute(`/api/${path}`, body || {}, { compact, timeZone });
  } };
}
