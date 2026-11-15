import { validateTask, validateFeedback } from './coach.js';

// A small, deterministic quality gate for model outputs. It checks observable
// teaching requirements without pretending to judge fluency with another model.
export const evaluationCases = [
  { id: 'reading-main-idea', mode: '阅读', kind: 'choice', skill: '阅读', promptIncludes: ['main idea'], requiresPassage: true },
  { id: 'listening-detail', mode: '听力', kind: 'listening', skill: '听力', promptIncludes: ['when'], requiresAudio: true },
  { id: 'writing-original-meaning', mode: '写作', kind: 'text', skill: '表达', suggestionIncludes: ['shop'], preserveAnswerTokens: ['shop', 'vegetables'] },
  { id: 'conversation-follow-up', mode: '对话', kind: 'conversation', skill: '表达', promptIncludes: ['already'] },
  { id: 'grammar-choice', mode: '综合', kind: 'choice', skill: '语法' },
];

const normalized = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function evaluateTaskOutput(caseDef, candidate) {
  const failures = [];
  let task;
  try { task = validateTask(candidate, { mode: caseDef.mode, history: [] }); }
  catch (error) { return { id: caseDef.id, type: 'task', passed: false, failures: [error.message] }; }
  if (task.kind !== caseDef.kind) failures.push(`题型应为 ${caseDef.kind}，实际为 ${task.kind}`);
  if (task.skill !== caseDef.skill) failures.push(`能力应为 ${caseDef.skill}，实际为 ${task.skill}`);
  const prompt = normalized(task.prompt);
  for (const phrase of caseDef.promptIncludes || []) if (!prompt.includes(normalized(phrase))) failures.push(`题干缺少要求的信息：${phrase}`);
  if (caseDef.requiresPassage && !task.passage) failures.push('阅读题没有完整材料');
  if (caseDef.requiresAudio && !task.audio) failures.push('听力题没有音频原文');
  return { id: caseDef.id, type: 'task', passed: failures.length === 0, failures, task };
}

export function evaluateFeedbackOutput(caseDef, task, answer, candidate) {
  const failures = [];
  let feedback;
  try { feedback = validateFeedback(candidate, task, answer); }
  catch (error) { return { id: caseDef.id, type: 'feedback', passed: false, failures: [error.message] }; }
  if (typeof caseDef.expectedCorrect === 'boolean' && feedback.correct !== caseDef.expectedCorrect) failures.push('正确性判断与评测样例不一致');
  const suggestion = normalized(feedback.suggestion);
  for (const phrase of caseDef.suggestionIncludes || []) if (!suggestion.includes(normalized(phrase))) failures.push(`表达建议缺少保留信息：${phrase}`);
  for (const phrase of caseDef.preserveAnswerTokens || []) if (!suggestion.includes(normalized(phrase))) failures.push(`表达建议没有保留原句细节：${phrase}`);
  if (caseDef.openAnswer && suggestion && suggestion === normalized(task.answer)) failures.push('开放题表达建议直接复用了参考答案');
  return { id: caseDef.id, type: 'feedback', passed: failures.length === 0, failures, feedback };
}

export function summarizeEvaluation(results) {
  const passed = results.filter(result => result.passed).length;
  return { passed, total: results.length, score: results.length ? passed / results.length : 0, failures: results.filter(result => !result.passed) };
}
