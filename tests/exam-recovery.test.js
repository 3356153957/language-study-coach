import { randomUUID } from 'node:crypto';
import { assessmentPrompt } from '../server/exam-assessment.js';
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

test('manual decimal prediction survives backup, cloud merge and engine restart', async () => {
  const initialState=predictionFixture(), active=structuredClone(initialState.sessions.at(-1));
  active.id='decimal-round';active.finishedAt=null;active.report=null;initialState.sessions.push(active);
  let saved;
  const engine=createEngine({initialState,save:async value=>{saved=structuredClone(value);},modelCall:async(_config,prompt)=>prompt===assessmentPrompt?{probability:12.23,reason:'新一轮独立作答依据'}:({...initialState.sessions[4].report,examEstimate:{probability:99,reason:'小结里的预测应被忽略'}})});
  await engine.execute('/api/session/finish',{sessionId:active.id});
  assert.equal(engine.view().examOutlook['四级'].estimate.probabilityText,'45.00%');
  await engine.execute('/api/exam/assess',{goal:'四级',requestId:randomUUID()});
  const portable=exportBackup(saved);
  for(const state of [saved,planImport({version:1,sessions:[]},portable).state,mergeCloudRecords({version:1,sessions:[]},recordsFromBackup(portable))]){
    const value=createEngine({initialState:state,save:async()=>{}}).view().examOutlook['四级'];
    assert.equal(value.estimate.probabilityText,'12.23%');
    assert.equal(value.change,-32.77);assert.equal(value.previous.probability,45);
  }
});
