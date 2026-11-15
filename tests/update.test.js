import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGitHubRelease, isNewerVersion } from '../src/update.js';

test('GitHub update check only returns safe release metadata and compares versions', async () => {
  assert.equal(isNewerVersion('1.5.0', '1.4.0'), true);
  assert.equal(isNewerVersion('1.4.0', '1.4.0'), false);
  const result = await checkGitHubRelease({ currentVersion: '1.4.0', fetcher: async () => Response.json({ tag_name: 'v1.5.0', html_url: 'https://github.com/3356153957/language-study-coach/releases/tag/v1.5.0', body: 'untrusted release notes' }) });
  assert.deepEqual(result, { current: '1.4.0', latest: '1.5.0', updateAvailable: true, releaseUrl: 'https://github.com/3356153957/language-study-coach/releases/tag/v1.5.0' });
});

test('private GitHub release remains an actionable unavailable state', async () => {
  await assert.rejects(checkGitHubRelease({ currentVersion: '1.4.0', fetcher: async () => new Response('', { status: 404 }) }), /私有仓库/);
});
