import { skills, validateExamEstimate } from './coach.js';
import { independentCounts } from './answer-results.js';

export const MIN_SKILL_EVIDENCE = 3;
export const MIN_PROFILE_EVIDENCE = 5;

export function profileEvidence(state) {
  const counts = Object.fromEntries(skills.map(name => [name, { count: 0, correct: 0 }]));
  for (const round of state.sessions || []) for (const entry of round.history || []) {
    const skill = entry.task?.skill;
    if (!counts[skill]) continue;
    const result = independentCounts(entry);
    counts[skill].count += result.count;
    counts[skill].correct += result.correct;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value.count, 0);
  return { counts, total, covered: Object.values(counts).filter(value => value.count > 0).length };
}

export function gateProfile(state, profile) {
  if (!profile) return profile;
  const evidence = profileEvidence(state);
  const levelReady = evidence.total >= MIN_PROFILE_EVIDENCE && evidence.covered >= 3;
  return {
    ...profile,
    level: levelReady ? profile.level : '待积累',
    skills: skills.map(name => {
      const item = profile.skills?.find(skill => skill.name === name) || { name };
      const ready = evidence.counts[name].count >= MIN_SKILL_EVIDENCE;
      return ready ? item : {
        ...item,
        level: evidence.counts[name].count ? '练习中' : '待积累',
        evidence: evidence.counts[name].count ? `已完成 ${evidence.counts[name].count} 道${name}练习。` : `完成 ${name} 练习后查看进展。`,
      };
    }),
  };
}

// Retain legacy goal profiles as source records, but expose one learner profile.
export function sharedProfile(state) {
  if (state.profile) return state.profile;
  const previous = Object.values(state.profiles || {}).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (!previous.length) return null;
  return { ...previous[0], skills: skills.map(name => previous.flatMap(p => p.skills || []).find(s => s.name === name && s.level !== '未测评') || { name, level: '未测评', evidence: '还没有该能力的作答记录。' }) };
}

export function examEvidence(state, goal) {
  const entries = [];
  for (let i = state.sessions.length - 1; i >= 0 && entries.length < 60; i--) {
    const round = state.sessions[i];
    if (round.goal !== goal || round.placement || !round.history.length) continue;
    for (let j = round.history.length - 1; j >= 0 && entries.length < 60; j--) entries.push(round.history[j]);
  }
  const independent = entries.filter(e => independentCounts(e).count > 0);
  const count = independent.reduce((n, entry) => n + independentCounts(entry).count, 0);
  const skillCounts = Object.fromEntries(['阅读', '听力', '表达'].map(skill => [skill, independent.filter(e => e.task.skill === skill).reduce((n, entry) => n + independentCounts(entry).count, 0)]));
  const covered = Object.keys(skillCounts).filter(skill => skillCounts[skill] >= 3);
  const countProgress = Math.min(1, count / 20);
  const skillProgress = Math.min(1, ...Object.values(skillCounts).map(count => count / 3));
  return { count, requiredCount: 20, skillCounts, covered,
    progress: Math.round(Math.min(countProgress, skillProgress) * 100),
    ready: count >= 20 && covered.length === 3,
    requirement: '至少 20 道无提示作答的小题，阅读、听力、表达各至少 3 道；标记不会的小题不计入。这里只是初步估计的最低样本要求。' };
}

export function examOutlook(state) {
  return Object.fromEntries(['四级', '六级'].map(goal => {
    const evidence = examEvidence(state, goal);
    // Archived reports are the portable source of truth. Older releases kept an
    // additional cache that did not travel with backups or cloud round records.
    const rounds = state.sessions.filter(round => round.goal === goal && !round.placement);
    const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
    const reportTime = round => timestamp(round.report?.updatedAt || round.finishedAt);
    const reports = rounds.filter(round => round.finishedAt && round.report).sort((a, b) => reportTime(b) - reportTime(a));
    const candidates = reports.map(round => ({ value: validateExamEstimate(round.report.examEstimate), time: reportTime(round) })).filter(c => c.value);
    for (const round of rounds) for (const item of round.examAssessments || []) { const value=validateExamEstimate(item); if(value) candidates.push({value,time:timestamp(item.updatedAt)}); }
    const cache = { value: validateExamEstimate(state.examEstimates?.[goal]), time: timestamp(state.examEstimates?.[goal]?.updatedAt) };
    // Cache and report normally describe the same event (older releases wrote
    // finishedAt milliseconds later). Never show that duplicate as a new change.
    if (cache.value && !candidates.some(c => JSON.stringify(c.value) === JSON.stringify(cache.value) && (!cache.time || Math.abs(c.time - cache.time) <= 1000))) candidates.push(cache);
    candidates.sort((a, b) => b.time - a.time);
    const present = candidate => {
      if (!candidate) return null;
      const value = candidate.value, legacy = !Object.hasOwn(value, 'probability');
      const probability = legacy ? (value.low + value.high) / 2 : value.probability;
      return { ...value, probability, probabilityText: probability.toFixed(2) + '%',
        sourceNote: legacy ? '沿用历史区间中点，点击 AI 评估可更新。' : '',
        updatedAt: candidate.time ? new Date(candidate.time).toISOString() : null };
    };
    const current = candidates[0], estimate = present(current);
    const previous = current?.time ? present(candidates.find(c => c.time > 0 && c.time < current.time)) : null;
    const change = previous ? Math.round((estimate.probability - previous.probability) * 100) / 100 : null;
    const changeText = change === null ? '' : change === 0 ? '较上次持平' : `较上次 ${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(2)} 个百分点`;
    const canAssess = evidence.count > 0;
    const status = estimate ? evidence.ready ? 'estimated' : 'historical' : canAssess ? 'ready' : 'collecting';
    const statusText = estimate ? '最近一次评估' : canAssess ? '点击 AI 评估' : '先积累练习记录';
    const message = canAssess ? '根据最新练习，点击更新 AI 备考评估。' : '完成一道独立练习后，查看 AI 备考评估。';
    return [goal, { ...evidence, canAssess, estimate, previous, change, changeText, status, statusText, message }];
  }));
}
