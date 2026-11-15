import { skills } from './coach.js';

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
  const independent = entries.filter(e => !e.hintUsed && !e.transcriptViewed);
  const covered = ['阅读', '听力', '表达'].filter(skill => independent.filter(e => e.task.skill === skill).length >= 3);
  return { count: independent.length, covered, ready: independent.length >= 20 && covered.length === 3,
    requirement: '至少 20 道无提示作答，阅读、听力、表达各至少 3 道；这只是生成初步估计的最低样本要求。' };
}

export function examOutlook(state) {
  return Object.fromEntries(['四级', '六级'].map(goal => {
    const evidence = examEvidence(state, goal);
    const estimate = state.examEstimates?.[goal];
    return [goal, { ...evidence, estimate: evidence.ready ? estimate || null : null }];
  }));
}
