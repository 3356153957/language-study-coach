import { AppError } from './providers.js';
import { validateExamEstimate } from './coach.js';

export const assessmentPrompt = `你是英语学习教练。用户主动请求评估当前 goal 的通过概率（425 分）。只返回 JSON {"probability":0至100的数值、最多两位小数,"reason":"具体依据、缺失能力、样本局限"}。根据 history 的材料难度、独立作答、正确率、题型覆盖和时间综合判断，不把 CEFR 或正确率直接换算通过率。evidence.ready=false 表示样本未达到建议量，仍可提供谨慎的初步估计，但必须明确局限。无法合理判断时返回 {"probability":null,"reason":"还需要哪些练习"}。两位小数仅展示变化，不代表经过真实考试校准；相同证据无需人为制造波动。previous 是上次评估，仅作比较。不要出题、批改或更新能力画像。`;
export function validateAssessments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new AppError('通过率评估记录无效。');
  const ids = new Set();
  return value.map(item => {
    const estimate = validateExamEstimate(item);
    if (!estimate || !Object.hasOwn(estimate,'probability') || !/^[a-f\d-]{36}$/i.test(item.id) || ids.has(item.id) || !Number.isFinite(Date.parse(item.updatedAt))) throw new AppError('通过率评估记录无效。');
    ids.add(item.id);
    return { ...estimate, id: item.id, updatedAt: new Date(item.updatedAt).toISOString() };
  });
}
export function mergeAssessments(a = [], b = []) {
  const map = new Map();
  for (const item of [...a,...b]) {
    const previous=map.get(item.id);
    if (previous && JSON.stringify(previous)!==JSON.stringify(item)) throw new AppError('通过率评估记录冲突，请保留本机备份。');
    map.set(item.id,item);
  }
  return [...map.values()].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id)).slice(-100);
}
