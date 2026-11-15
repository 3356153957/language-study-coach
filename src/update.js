import { AppError } from '../server/providers.js';

const releaseURL = 'https://api.github.com/repos/3356153957/language-study-coach/releases/latest';
const versionParts = value => String(value || '0').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0).slice(0, 3);
export function isNewerVersion(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  return [0, 1, 2].some((index) => a[index] > b[index]) && ![0, 1, 2].some((index) => a[index] < b[index]);
}
export async function checkGitHubRelease({ fetcher = fetch, currentVersion }) {
  let response;
  try { response = await fetcher(releaseURL, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new AppError('暂时无法读取 GitHub 更新，请检查网络后重试。', 502); }
  if (response.status === 404) throw new AppError('当前私有仓库不能匿名读取 Release；发布页可由登录 GitHub 的用户查看。', 403);
  if (!response.ok) throw new AppError('GitHub 更新服务暂时不可用，请稍后重试。', 502);
  let data; try { data = await response.json(); } catch { throw new AppError('GitHub 更新信息格式无效。', 502); }
  const latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : '';
  if (!latest || latest.length > 40 || /[^0-9A-Za-z.+-]/.test(latest)) throw new AppError('GitHub 更新信息格式无效。', 502);
  return { current: currentVersion, latest, updateAvailable: isNewerVersion(latest, currentVersion), releaseUrl: typeof data.html_url === 'string' ? data.html_url : '' };
}
