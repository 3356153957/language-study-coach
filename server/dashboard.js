// Only summaries travel with routine requests. Full rounds and mistakes are read on demand.
import { answerCounts, roundCounts } from './answer-results.js';
export function roundSummary(s) {
  return { id: s.id, goal: s.goal, mode: s.mode, placement: s.placement, startedAt: s.startedAt, finishedAt: s.finishedAt,
    ...roundCounts(s.history), taskCount: s.history.length,
    seconds: s.history.reduce((n, x) => n + (x.activeSeconds || 0), 0) };
}

export function activityData(state, offset = 0) {
  offset = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
  const items = []; let total = 0;
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const session = state.sessions[i];
    if (!session.finishedAt) continue;
    if (total >= offset && items.length < 20) items.push(roundSummary(session));
    total++;
  }
  return { items, total, offset, hasMore: offset + items.length < total };
}

export function dashboardData(state, timeZone = 'UTC', now = new Date()) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  const day = date => formatter.format(new Date(date));
  // Step through calendar dates, not local 24-hour intervals across DST changes.
  const today = Date.parse(`${day(now)}T12:00:00Z`);
  const dates = Array.from({ length: 7 }, (_, i) => new Date(today - (6 - i) * 86400000).toISOString().slice(0, 10));
  const blank = () => ({ count: 0, correct: 0, seconds: 0, days: dates.map(date => ({ date, count: 0, correct: 0, seconds: 0 })) });
  const totals = { all: blank() }, recent = [], perGoal = {};
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    totals[s.goal] ||= blank();
    for (const h of s.history) {
      const score = answerCounts(h);
      const entryDay = h.at && new Date(h.at).getTime() >= now.getTime() - 8 * 86400000 ? day(h.at) : null;
      for (const bucket of [totals.all, totals[s.goal]]) {
        bucket.count += score.count; bucket.correct += score.correct; bucket.seconds += h.activeSeconds || 0;
        if (entryDay) { const d = bucket.days.find(x => x.date === entryDay); if (d) { d.count += score.count; d.correct += score.correct; d.seconds += h.activeSeconds || 0; } }
      }
    }
    if (s.finishedAt && (perGoal[s.goal] || 0) < 5) {
      perGoal[s.goal] = (perGoal[s.goal] || 0) + 1;
      recent.push(roundSummary(s));
    }
  }
  return { totals, recent };
}
