// Reproducible synthetic history; does not read any user learning data.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { createEngine } = await import(pathToFileURL(path.resolve(process.argv[2] || 'server/engine.js')));
const sessions = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, goal: '四级', mode: '综合', finishedAt: '2026-11-01T12:00:00Z',
  history: Array.from({ length: 5 }, (_, j) => ({ id: `h${i}-${j}`, at: '2026-11-01T12:00:00Z', activeSeconds: 60,
    task: { id: `t${i}-${j}`, skill: '阅读', level: 'A2', prompt: 'What is the main idea?', passage: 'A short English reading passage. '.repeat(30), answer: 'A', options: ['A','B'] },
    answer: 'B', feedback: { correct: false, explanation: '这是一段用于性能测试的解析。'.repeat(30), weakness: '文章主旨', suggestion: '' } })) }));
let peak = 0;
const engine = createEngine({ initialState: { version: 1, sessions, profiles: {}, config: { provider: 'compatible', model: 'fixture', apiKey: 'test-only', baseURL: 'https://fixture.invalid' } },
  modelCall: async () => ({ ok: true }), save: async () => { peak = Math.max(peak, process.memoryUsage().heapUsed); } });
global.gc?.();
const base = process.memoryUsage().heapUsed, times = [];
for (let i = 0; i < 5; i++) { global.gc?.(); const start = performance.now(); await engine.execute('/api/settings/test', {}); times.push(performance.now() - start); }
const payload = JSON.stringify(engine.view({ compact: true, timeZone: 'UTC' }));
console.log(JSON.stringify({ sessions: 1000, answers: 5000, baseHeapMB: +(base/1048576).toFixed(2), mutationPeakDeltaMB: +((peak-base)/1048576).toFixed(2), payloadBytes: Buffer.byteLength(payload), mutationMedianMs: +times.sort((a,b)=>a-b)[2].toFixed(2) }, null, 2));
