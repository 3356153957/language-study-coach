import { AppError } from './providers.js';
import { goals } from './coach.js';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new AppError('学习背景字段缺失或过长。');
  return value.trim();
}
function list(value, limit = 12) {
  if (!Array.isArray(value) || value.length > limit) throw new AppError('学习背景列表格式不正确。');
  return value.map(item => text(item, 600));
}

// Imported observations guide teaching; they never create grades or study time.
export function validateBackground(input) {
  if (!goals.includes(input.goal) || input.source?.kind !== 'codex-chat' || !uuid(input.source.threadId)) throw new AppError('学习背景目标或聊天来源无效。');
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 24) throw new AppError('请提供可核对的聊天摘录。');
  const evidence = input.evidence.map(item => {
    if (!uuid(item.turnId) || !Number.isFinite(Date.parse(item.observedAt))) throw new AppError('聊天摘录来源无效。');
    return { turnId: item.turnId, observedAt: new Date(item.observedAt).toISOString(), learnerText: text(item.learnerText, 2500), observation: text(item.observation, 600) };
  });
  return { goal: input.goal, source: { kind: 'codex-chat', threadId: input.source.threadId, title: text(input.source.title, 200) },
    summary: text(input.summary, 1200), coveredTopics: list(input.coveredTopics), strengths: list(input.strengths),
    needsPractice: list(input.needsPractice), preferences: list(input.preferences), evidence };
}
