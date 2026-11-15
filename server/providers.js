export const providers = {
  chatgpt: { label: 'ChatGPT 订阅账号', protocol: 'chatgpt', baseURL: 'https://api.openai.com/v1' },
  codex: { label: '本机 Codex · ChatGPT 授权', protocol: 'codex', baseURL: '' },
  openai: { label: 'OpenAI', protocol: 'openai', baseURL: 'https://api.openai.com/v1' },
  deepseek: { label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com/v1' },
  compatible: { label: 'OpenAI 兼容接口', protocol: 'openai', baseURL: '' },
  anthropic: { label: 'Anthropic', protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1' },
  gemini: { label: 'Google Gemini', protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
};

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateConfig(input, previous = {}) {
  const preset = providers[input.provider];
  if (!preset) throw new AppError('请选择支持的接口类型。');
  if (input.provider === 'codex' || input.provider === 'chatgpt') {
    const model = String(input.model || '').trim();
    if (model.length > 200 || /[\r\n]/.test(model)) throw new AppError('模型 ID 格式不正确。');
    return { provider: input.provider, baseURL: input.provider === 'chatgpt' ? preset.baseURL : '', model };
  }
  const baseURL = String(input.baseURL || preset.baseURL).trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(baseURL); } catch { throw new AppError('API 地址格式不正确。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new AppError('API 地址须使用 HTTPS；本机服务可用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new AppError('API 地址不能带凭据、查询参数或锚点。');
  const model = String(input.model || '').trim();
  if (!model || model.length > 200) throw new AppError('请填写供应商提供的模型 ID。');
  // A key can only be retained for exactly the same upstream destination.
  const same = input.provider === previous.provider && baseURL === previous.baseURL;
  const apiKey = String(input.apiKey || (same ? previous.apiKey || '' : '')).trim();
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new AppError('请填写 API Key；切换供应商或地址时需重新填写。');
  return { provider: input.provider, baseURL, model, apiKey };
}

export function parseJSON(text) {
  if (typeof text !== 'string') throw new AppError('模型没有返回文本，请更换支持文本生成的模型。', 502);
  try {
    const result = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new AppError('模型返回格式不正确，本次内容未保存，可以重试。', 502); }
}

export async function callModel(config, system, context, fetcher = fetch) {
  if (!config?.apiKey) throw new AppError('请先在模型设置中配置 API。', 409);
  const protocol = providers[config.provider]?.protocol;
  const content = JSON.stringify(context);
  let url, body, headers = { 'Content-Type': 'application/json' };
  if (protocol === 'anthropic') {
    url = `${config.baseURL}/messages`;
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: 4096, system, messages: [{ role: 'user', content }] };
  } else if (protocol === 'gemini') {
    url = `${config.baseURL}/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
    headers['x-goog-api-key'] = config.apiKey;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: content }] }], generationConfig: { responseMimeType: 'application/json' } };
  } else {
    url = `${config.baseURL}/chat/completions`;
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
  }
  let response;
  try {
    response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000), redirect: 'error' });
  } catch (error) {
    throw new AppError(error.name === 'TimeoutError' ? '模型响应超过 60 秒，请重试或更换模型。' : '无法连接模型服务，请检查地址和网络。', 502);
  }
  if (!response.ok) {
    const hints = { 401: 'API Key 无效', 403: '没有模型访问权限', 404: '接口地址或模型 ID 不存在', 429: '请求过多或额度不足' };
    throw new AppError(`模型服务返回 ${response.status}：${hints[response.status] || '请求失败，请检查配置或稍后重试'}。`, 502);
  }
  let data;
  try { data = await response.json(); } catch { throw new AppError('模型服务没有返回有效 JSON。', 502); }
  const text = protocol === 'anthropic' ? data.content?.filter(x => x.type === 'text').map(x => x.text).join('')
    : protocol === 'gemini' ? data.candidates?.[0]?.content?.parts?.filter(x => !x.thought).map(x => x.text || '').join('')
    : data.choices?.[0]?.message?.content;
  return parseJSON(text);
}
