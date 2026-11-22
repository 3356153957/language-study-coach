import { AppError } from '../server/providers.js';

const repository = '3356153957/language-study-coach';
const releasesAPI = `https://api.github.com/repos/${repository}/releases`;
export const releasesPage = `https://github.com/${repository}/releases`;
const versionParts = value => String(value || '0').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0).slice(0, 3);
export function isNewerVersion(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

async function fetchReleases(url, fetcher, signal) {
  let response;
  try { response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', redirect: 'error', signal }); }
  catch { throw new AppError('暂时无法读取 GitHub 更新，请检查网络后重试。', 502); }
  if (response.status === 404) throw new AppError('GitHub 发布信息暂不可访问，请打开发布页查看。', 404);
  if (!response.ok) throw new AppError('GitHub 更新服务暂时不可用，请稍后重试。', 502);
  let data; try { data = await response.json(); } catch { throw new AppError('GitHub 更新信息格式无效。', 502); }
  return { data, hasNext: response.headers?.get('link')?.includes('rel="next"') };
}

export async function checkGitHubRelease({ fetcher = fetch, currentVersion }) {
  const { data } = await fetchReleases(`${releasesAPI}/latest`, fetcher, AbortSignal.timeout(15000));
  const latest = typeof data?.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : '';
  if (!latest || latest.length > 40 || /[^0-9A-Za-z.+-]/.test(latest)) throw new AppError('GitHub 更新信息格式无效。', 502);
  return { current: currentVersion, latest, updateAvailable: isNewerVersion(latest, currentVersion), releaseUrl: `${releasesPage}/tag/${encodeURIComponent(data.tag_name)}` };
}

export async function checkWindowsRelease({ fetcher = fetch, currentVersion }) {
  const signal = AbortSignal.timeout(15000);
  let latest;
  for (let page = 1; ; page++) {
    const { data, hasNext } = await fetchReleases(`${releasesAPI}?per_page=100&page=${page}`, fetcher, signal);
    if (!Array.isArray(data)) throw new AppError('GitHub 更新信息格式无效。', 502);
    for (const release of data) {
      if (release?.draft || release?.prerelease || typeof release?.tag_name !== 'string') continue;
      const version = /^v(\d{1,8}\.\d{1,8}\.\d{1,8})-desktop$/.exec(release.tag_name)?.[1];
      if (!version || !Array.isArray(release.assets)) continue;
      if (!release.assets.some(asset => asset?.name === `LanguageStudyCoach-Desktop-${version}-x64.exe`)) continue;
      if (!latest || isNewerVersion(version, latest)) latest = version;
    }
    if (!hasNext) break;
  }
  if (!latest) throw new AppError('GitHub 上暂未找到 Windows 正式安装包。', 404);
  return { current: currentVersion, latest, updateAvailable: isNewerVersion(latest, currentVersion), releaseUrl: `${releasesPage}/tag/v${latest}-desktop` };
}
