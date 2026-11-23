import { AppError, gpt62Models, isOfficialOpenAI, providers } from './providers.js';

// Only construct pagination requests on the configured destination. Upstream
// next-page URLs are never followed, and credentials stay in request headers.
export async function listModels(config, fetcher = fetch) {
  const protocol = providers[config.provider]?.protocol;
  const headers = { Accept: 'application/json' };
  if (protocol === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (protocol === 'gemini') headers['x-goog-api-key'] = config.apiKey;
  else headers.Authorization = `Bearer ${config.apiKey}`;
  const models = new Map(), cursors = new Set();
  const signal = AbortSignal.timeout(15000);
  let cursor = '', truncated = false;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${config.baseURL}/models`);
    if (protocol === 'anthropic') url.searchParams.set('limit', '1000');
    if (protocol === 'gemini') url.searchParams.set('pageSize', '1000');
    if (cursor) url.searchParams.set(protocol === 'gemini' ? 'pageToken' : 'after_id', cursor);
    let response, data;
    try {
      signal.throwIfAborted();
      response = await fetcher(url.href, { method: 'GET', headers, redirect: 'error', signal });
      if (response.ok) data = await response.json();
    } catch (e) {
      throw new AppError(signal.aborted || ['AbortError', 'TimeoutError'].includes(e.name)
        ? '获取模型列表超时，请重试或手动填写模型 ID。'
        : '无法获取模型列表，请检查接口地址和网络；也可手动填写模型 ID。', 502);
    }
    if (!response.ok) {
      const hint = {401: 'API Key 无效，请检查后重试。',403: '当前密钥没有获取模型列表的权限，可以手动填写模型 ID。',
        404: '上游未提供模型列表接口，可以手动填写模型 ID。',405: '上游未提供模型列表接口，可以手动填写模型 ID。',
        429: '上游请求过多或额度不足，请稍后刷新。'}[response.status];
      throw new AppError(hint || `获取模型列表失败（${response.status}），可以稍后刷新或手动填写模型 ID。`, 502);
    }
    const rows = protocol === 'gemini' ? data?.models : data?.data;
    if (!Array.isArray(rows)) throw new AppError('上游返回的模型列表格式无法识别，可以手动填写模型 ID。', 502);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (protocol === 'gemini' && (!Array.isArray(row.supportedGenerationMethods) || !row.supportedGenerationMethods.includes('generateContent'))) continue;
      if (Array.isArray(row.output_modalities) && !row.output_modalities.includes('text')) continue;
      const id = protocol === 'gemini' ? (typeof row.name === 'string' ? row.name.replace(/^models\//, '') : '') : row.id;
      if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) continue;
      const display = row.display_name || row.displayName || row.name || id;
      const name = typeof display === 'string' ? display.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) : id;
      if (models.size >= 2000 && !models.has(id)) { truncated = true; break; }
      models.set(id, { id, name });
    }
    const next = protocol === 'gemini' ? data.nextPageToken : data.has_more === true ? data.last_id : '';
    if (data.has_more === true && !next) throw new AppError('上游的模型分页响应异常，可以手动填写模型 ID。', 502);
    if (!next || truncated) break;
    if (typeof next !== 'string' || next.length > 2048 || cursors.has(next)) throw new AppError('上游的模型分页响应异常，可以手动填写模型 ID。', 502);
    cursors.add(next); cursor = next;
    if (page === 9) truncated = true;
  }
  if (isOfficialOpenAI(config)) {
    const featured = [];
    for (const [id, name] of gpt62Models) {
      if (models.delete(id)) featured.push({ id, name });
    }
    return { models: [...featured, ...models.values()], truncated };
  }
  return { models: [...models.values()], truncated };
}
