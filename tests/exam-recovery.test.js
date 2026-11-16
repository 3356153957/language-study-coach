import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../server/engine.js';
import { exportBackup, planImport } from '../server/backup.js';
import { recordsFromBackup, mergeCloudRecords } from '../server/sync-records.js';
import { examOutlook } from '../server/profile.js';

import { predictionFixture } from './fixtures/exam-fixture.js';

test('old-format backup and cloud records restore predictions without a top-level cache', () => {
  const source = predictionFixture(), portable = exportBackup(source);
  assert.equal(portable.data.examEstimates, undefined);
  const imported = planImport({ version: 1, sessions: [] }, portable).state;
  const synced = mergeCloudRecords({ version: 1, sessions: [] }, recordsFromBackup(portable));
  for (const state of [source, imported, synced]) {
    const outlook = examOutlook(state);
    assert.equal(outlook['四级'].ready, true);
    assert.equal(outlook['四级'].estimate?.high, 60);
    assert.equal(outlook['六级'].estimate, null);
  }
});

test('finishing a round without a new estimate retains the old prediction and explains the pending update', async () => {
  const initialState = predictionFixture();
  const active = structuredClone(initialState.sessions.at(-1));
  active.id = 'active'; active.finishedAt = null; active.report = null;
  active.history = [active.history[0]]; initialState.sessions.push(active);
  let saved;
  const engine = createEngine({ initialState, save: async value => { saved = structuredClone(value); }, modelCall: async () => ({ ...initialState.sessions[4].report, examEstimate: null }) });
  await engine.execute('/api/session/finish', { sessionId: 'active' });
  assert.equal(saved.examEstimates['四级']?.high, 60);
  assert.equal(engine.view().examOutlook['四级'].estimate.high, 60);
  assert.match(engine.view().examOutlook['四级'].message, /保留上次/);
});
