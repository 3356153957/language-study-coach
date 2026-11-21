import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSONBody } from '../server/api.js';

// Simulates an HTTP request stream that delivers the body in arbitrary byte chunks.
const chunked = (bytes, size) => ({ async *[Symbol.asyncIterator]() { for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size); } });

test('request bodies keep Chinese text intact when a character is split across chunks', async () => {
  const value = { backup: { note: '四六级听力：长对话与讲座'.repeat(50), emoji: '学习📚' } };
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  for (const size of [1, 2, 5, 7, 4096]) {
    assert.deepEqual(await readJSONBody(chunked(bytes, size), bytes.length), value, `chunk size ${size}`);
  }
});

test('request bodies over the byte limit are rejected with 413, counting bytes rather than characters', async () => {
  const bytes = Buffer.from(JSON.stringify({ text: '中'.repeat(100) }), 'utf8');
  await assert.rejects(readJSONBody(chunked(bytes, 16), bytes.length - 1), error => error.status === 413);
  assert.deepEqual(await readJSONBody(chunked(bytes, 16), bytes.length), { text: '中'.repeat(100) });
});

test('request bodies must be a JSON object', async () => {
  for (const body of ['{broken', '[]', 'null', '"text"']) {
    await assert.rejects(readJSONBody(chunked(Buffer.from(body), 3), 1000), /有效 JSON|请求格式不正确/, body);
  }
});
