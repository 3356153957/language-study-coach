import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGitHubRelease, checkWindowsRelease, isNewerVersion } from '../src/update.js';

test('GitHub update check only returns safe release metadata and compares versions', async () => {
  assert.equal(isNewerVersion('1.5.0', '1.4.0'), true);
  assert.equal(isNewerVersion('1.4.0', '1.4.0'), false);
  const result = await checkGitHubRelease({ currentVersion: '1.4.0', fetcher: async () => Response.json({ tag_name: 'v1.5.0', html_url: 'https://github.com/3356153957/language-study-coach/releases/tag/v1.5.0', body: 'untrusted release notes' }) });
  assert.deepEqual(result, { current: '1.4.0', latest: '1.5.0', updateAvailable: true, releaseUrl: 'https://github.com/3356153957/language-study-coach/releases/tag/v1.5.0' });
});

test('an unavailable GitHub release points to the release page', async () => {
  await assert.rejects(checkGitHubRelease({ currentVersion: '1.4.0', fetcher: async () => new Response('', { status: 404 }) }), /请打开发布页/);
});

function windowsRelease(version, overrides = {}) {
  return {
    tag_name: `v${version}-desktop`,
    assets: [{ name: `LanguageStudyCoach-Desktop-${version}-x64.exe` }],
    ...overrides,
  };
}

test('Windows checks select the highest stable version with an installer across release pages', async () => {
  const pages = [
    Response.json([
      windowsRelease('4.0.0', { draft: true }),
      windowsRelease('3.0.0', { prerelease: true }),
      { tag_name: 'v5.0.0', assets: [{ name: 'LanguageStudyCoach-unsigned.ipa' }] },
      windowsRelease('2.5.0', { assets: [{ name: 'SHA256SUMS.txt' }] }),
      windowsRelease('1.9.10'),
    ], { headers: { link: '<https://api.github.com/example?page=2>; rel="next"' } }),
    Response.json([windowsRelease('2.0.0', { html_url: 'https://untrusted.example/' }), windowsRelease('1.10.0')]),
  ];
  const urls = [];
  const result = await checkWindowsRelease({ currentVersion: '1.9.20', fetcher: async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, 'omit');
    return pages.shift();
  } });
  assert.deepEqual(urls.map(url => new URL(url).searchParams.get('page')), ['1', '2']);
  assert.ok(urls.every(url => new URL(url).host === 'api.github.com'));
  assert.deepEqual(result, {
    current: '1.9.20', latest: '2.0.0', updateAvailable: true,
    releaseUrl: 'https://github.com/3356153957/language-study-coach/releases/tag/v2.0.0-desktop',
  });
});

test('Windows checks distinguish unavailable installers from an up-to-date app', async () => {
  const fetcher = async () => Response.json([windowsRelease('1.0.8')]);
  for (const currentVersion of ['1.0.8', '1.0.9']) {
    assert.equal((await checkWindowsRelease({ currentVersion, fetcher })).updateAvailable, false);
  }
  await assert.rejects(checkWindowsRelease({ currentVersion: '1.0.8', fetcher: async () => Response.json([]) }), /未找到 Windows/);
});
