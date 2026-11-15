import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationCases, evaluateTaskOutput, evaluateFeedbackOutput, summarizeEvaluation } from '../server/evaluation.js';

const base = { level: 'A2', reason: '针对本轮目标练习。', prompt: 'What happened when you arrived?', passage: '', audio: '', options: [], answer: 'I arrived early.', hint: '先找时间信息。' };
const taskFor = (id, extra = {}) => ({ ...base, kind: 'text', skill: '表达', ...extra, id });

test('quality gate accepts mode-specific tasks and rejects incomplete materials', () => {
  const reading = evaluateTaskOutput(evaluationCases[0], taskFor('r1', { kind: 'choice', skill: '阅读', prompt: 'What is the main idea?', passage: 'Mia studies every morning.', options: ['She studies.', 'She sleeps.'], answer: 'She studies.' }));
  assert.equal(reading.passed, true);
  const brokenListening = evaluateTaskOutput(evaluationCases[1], taskFor('l1', { kind: 'listening', skill: '听力', prompt: 'When did it happen?', options: ['At one.', 'At two.'], answer: 'At one.' }));
  assert.equal(brokenListening.passed, false);
  assert.match(brokenListening.failures.join(' '), /完整|材料/);
});

test('quality gate protects original details in open-answer suggestions', () => {
  const c = evaluationCases[2];
  const task = taskFor('w1', { kind: 'text', skill: '表达', prompt: 'Explain the problem.', answer: 'I visited a nearby store for vegetables.' });
  const good = evaluateFeedbackOutput({ ...c, openAnswer: true, expectedCorrect: false }, task, 'I go shop buy vegetables', { correct: false, explanation: '过去时和冠词需要调整。', suggestion: 'I went to a shop to buy vegetables.', weakness: '过去时' });
  assert.equal(good.passed, true);
  const copied = evaluateFeedbackOutput({ ...c, openAnswer: true, expectedCorrect: false }, task, 'I go shop buy vegetables', { correct: false, explanation: '继续练习。', suggestion: task.answer, weakness: '语法' });
  assert.equal(copied.passed, false);
});

test('quality summary reports failures instead of hiding them', () => {
  const result = summarizeEvaluation([{ passed: true }, { passed: false, failures: ['缺少材料'] }]);
  assert.deepEqual(result, { passed: 1, total: 2, score: 0.5, failures: [{ passed: false, failures: ['缺少材料'] }] });
});
