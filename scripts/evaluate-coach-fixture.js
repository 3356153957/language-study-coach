import { readFile } from 'node:fs/promises';
import { evaluationCases, evaluateTaskOutput, evaluateFeedbackOutput, summarizeEvaluation } from '../server/evaluation.js';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/evaluate-coach-fixture.js path/to/fixture.json');
  process.exit(2);
}
const fixture = JSON.parse(await readFile(file, 'utf8'));
const cases = new Map(evaluationCases.map(item => [item.id, item]));
const results = [];
for (const item of fixture.tasks || []) {
  const caseDef = cases.get(item.case);
  if (!caseDef) throw new Error(`未知评测样例：${item.case}`);
  results.push(evaluateTaskOutput(caseDef, item.output));
}
for (const item of fixture.feedback || []) {
  const caseDef = cases.get(item.case);
  if (!caseDef) throw new Error(`未知评测样例：${item.case}`);
  results.push(evaluateFeedbackOutput(caseDef, item.task, item.answer, item.output));
}
const summary = summarizeEvaluation(results);
console.log(JSON.stringify(summary, null, 2));
if (summary.failures.length) process.exitCode = 1;
