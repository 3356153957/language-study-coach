import { skills, validateExamEstimate } from './coach.js';

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
  const skillCounts = Object.fromEntries(['阅读', '听力', '表达'].map(skill => [skill, independent.filter(e => e.task.skill === skill).length]));
  const covered = Object.keys(skillCounts).filter(skill => skillCounts[skill] >= 3);
  const countProgress = Math.min(1, independent.length / 20);
  const skillProgress = Math.min(1, ...Object.values(skillCounts).map(count => count / 3));
  return { count: independent.length, requiredCount: 20, skillCounts, covered,
    progress: Math.round(Math.min(countProgress, skillProgress) * 100),
    ready: independent.length >= 20 && covered.length === 3,
    requirement: '至少 20 道无提示作答，阅读、听力、表达各至少 3 道；这只是生成初步估计的最低样本要求。' };
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
    const candidates = [
      ...reports.map(round => ({ value: round.report.examEstimate, time: reportTime(round) })),
      { value: state.examEstimates?.[goal], time: timestamp(state.examEstimates?.[goal]?.updatedAt) },
    ].sort((a, b) => b.time - a.time);
    let estimate = null;
    for (const candidate of candidates) {
      const valid = validateExamEstimate(candidate.value);
      if (valid) { estimate = { ...valid, updatedAt: candidate.time ? new Date(candidate.time).toISOString() : null }; break; }
    }
    const latest = reports[0];
    const pending = !latest || rounds.some(round => round.history.length && !round.report && (!round.finishedAt || timestamp(round.finishedAt) > reportTime(latest)));
    const declined = latest && !validateExamEstimate(latest.report.examEstimate) && reportTime(latest) >= timestamp(estimate?.updatedAt);
    let status, statusText, message;
    if (estimate) {
      status = !evidence.ready || pending || declined ? 'historical' : 'estimated';
      statusText = '最近一次预测';
      message = !evidence.ready ? '保留历史预测。最近的独立作答还需补足阅读、听力与表达，才能重新估计。'
        : pending ? `已有新的练习依据，完成${goal}学习小结后尝试更新预测。`
        : declined ? '本轮未给出有效的新区间，保留上次预测。继续练习考试相关材料后再更新。' : '每次完成该目标的学习小结后，会根据新增表现尝试更新。';
    } else if (!evidence.ready) {
      status = 'collecting'; statusText = '预测依据积累中'; message = evidence.requirement;
    } else if (pending) {
      status = 'awaiting_summary'; statusText = '等待学习小结'; message = `已满足最低样本要求。完成${goal}学习小结后，AI 会尝试生成预测区间。`;
    } else {
      status = 'no_estimate'; statusText = '暂未形成预测'; message = '最低样本已满足，但最近小结未给出有效区间。继续练习考试相关的阅读、听力和写作，再完成学习小结。';
    }
    return [goal, { ...evidence, estimate, status, statusText, message }];
  }));
}
