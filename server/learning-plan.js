import { AppError } from './providers.js';

export function validateLearningPlan(input, updatedAt = new Date().toISOString()) {
  const minutesPerDay = Number(input?.minutesPerDay);
  if (!Number.isInteger(minutesPerDay) || minutesPerDay < 5 || minutesPerDay > 120) throw new AppError('每天学习时间请填写 5–120 分钟。');
  const scenario = typeof input?.scenario === 'string' ? input.scenario.trim() : '';
  if (scenario.length > 240) throw new AppError('学习场景最多填写 240 字。');
  const targetDate = input?.targetDate || '';
  if (targetDate && (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !Number.isFinite(Date.parse(targetDate)) || new Date(targetDate).toISOString().slice(0, 10) !== targetDate)) throw new AppError('请选择有效的目标日期。');
  if (!Number.isFinite(Date.parse(updatedAt))) throw new AppError('学习安排的更新时间无效。');
  return { minutesPerDay, targetDate, scenario, updatedAt: new Date(updatedAt).toISOString() };
}

export function validateLearningPlans(value, goals) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(goal => !goals.includes(goal))) throw new AppError('学习安排包含未知目标。');
  return Object.fromEntries(Object.entries(value).map(([goal, plan]) => [goal, validateLearningPlan(plan, plan.updatedAt)]));
}

// Capability reports and personal plans change independently on different
// devices. A later report must not replace a newer user-authored plan.
export function preserveLearningPlans(profile, other) {
  if (!profile) return other;
  const plans = {};
  for (const goal of [...new Set([...Object.keys(profile.learningPlans || {}), ...Object.keys(other?.learningPlans || {})])].sort()) {
    const a=profile.learningPlans?.[goal], b=other?.learningPlans?.[goal];
    plans[goal]=!a ? b : !b ? a : a.updatedAt > b.updatedAt ? a : b.updatedAt > a.updatedAt ? b : JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  return Object.keys(plans).length ? {...profile, learningPlans:plans} : profile;
}
