import { independentCounts } from './answer-results.js';
import { calendarDay } from './review-plan.js';

const skills = ['阅读', '听力', '词汇', '语法', '表达'];
const level = value => String(value || '').match(/\b(A1|A2|B1|B2|C1|C2)\b/)?.[0];
const shift = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const blank = () => ({ count: 0, correct: 0 });

export function learningProgress(state, profile, timeZone = 'UTC', now = new Date()) {
  const today = calendarDay(now, timeZone), recentStart = shift(today, -6), previousStart = shift(today, -13);
  const cohorts = new Map(), latest = {}, levelHistory = [];
  for (const round of state.sessions) {
    if (round.finishedAt && round.report && level(round.report.level)) levelHistory.push({ at: round.report.updatedAt || round.finishedAt, level: level(round.report.level), sessionId: round.id });
    for (const entry of round.history) {
      if (!entry.at || !Number.isFinite(Date.parse(entry.at)) || !level(entry.task.level)) continue;
      if (!latest[entry.task.skill] || entry.at > latest[entry.task.skill].at) latest[entry.task.skill] = { at: entry.at, level: level(entry.task.level) };
      const day = calendarDay(entry.at, timeZone);
      if (day < previousStart || day > today || entry.hintUsed || entry.transcriptViewed) continue;
      const key = `${entry.task.skill}:${level(entry.task.level)}`;
      if (!cohorts.has(key)) cohorts.set(key, { recent: blank(), previous: blank() });
      const bucket = cohorts.get(key)[day >= recentStart ? 'recent' : 'previous'], score = independentCounts(entry);
      bucket.count += score.count; bucket.correct += score.correct;
    }
  }
  const compare = (name, code) => {
    const buckets = cohorts.get(`${name}:${code}`) || { recent: blank(), previous: blank() };
    const ready = buckets.recent.count >= 5 && buckets.previous.count >= 5;
    const rate = bucket => bucket.count ? Math.round(bucket.correct / bucket.count * 100) : null;
    const recent = { ...buckets.recent, rate: rate(buckets.recent) }, previous = { ...buckets.previous, rate: rate(buckets.previous) };
    return { name, level: code || '', recent, previous, ready, change: ready ? recent.rate - previous.rate : null };
  };
  const comparisons = skills.map(name => compare(name, level(profile?.skills?.find(s => s.name === name)?.level) || latest[name]?.level));
  const otherComparisons = skills.flatMap(name => ['A1','A2','B1','B2','C1','C2'].filter(code => code !== comparisons.find(row => row.name === name).level && cohorts.has(`${name}:${code}`)).map(code => compare(name, code)));
  return { recentStart, previousStart, today, comparisons, otherComparisons,
    levelHistory: levelHistory.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
    note: '只比较同一能力、同一难度、未用提示或原文的回答；两个时间段各至少 5 道小题才显示变化。正确率变化不等于能力等级提升。' };
}
