import { questionResults } from './answer-results.js';
export function calendarDay(value, timeZone = 'UTC') {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
  catch { return new Date(value).toISOString().slice(0, 10); }
}
const addDays = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const validDate = value => value && Number.isFinite(Date.parse(value));
const clean = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Review plans are derived from real saved attempts, so backups and other
// devices never need a separate mutable queue or fabricated mastery score.
export function reviewPlan(state, timeZone = 'UTC', now = new Date()) {
  const today = calendarDay(now, timeZone), topics = new Map(), origins = new Map(), events = [], seen = new Set();
  for (const round of state.sessions) {
    for (let i = 0; i < round.history.length; i++) {
      const entry = round.history[i];
      if (!validDate(entry.at) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const reviewOf = entry.reviewOf || (i === 0 ? round.reviewId || round.review?.id : null);
      const reviewQuestionIndex = entry.reviewQuestionIndex ?? (i === 0 ? round.reviewQuestionIndex : undefined);
      if (reviewOf) { events.push({ entry, reviewOf, reviewQuestionIndex }); continue; }
      if (entry.feedback.correct) continue;
      const results = questionResults(entry.task, entry.answer, entry.feedback, entry.skippedQuestions);
      const weaknesses = results ? results.flatMap((result, index) => result.correct ? [] : [{ weakness: result.weakness || entry.feedback.weakness, index }]) : [{weakness:entry.feedback.weakness}];
      for (const {weakness, index} of weaknesses) {
        const key = `${round.goal}\0${entry.task.skill}\0${clean(weakness) || `${entry.id}-${index ?? 'whole'}`}`;
        let topic = topics.get(key);
        if (!topic) {
          topic = { goal: round.goal, skill: entry.task.skill, weakness: weakness || '本题知识点', streak: 0, attempts: 0 };
          topics.set(key, topic);
        }
        origins.set(`${entry.id}:${index ?? 'whole'}`, topic);
        if (!origins.has(`${entry.id}:whole`)) origins.set(`${entry.id}:whole`, topic);
        events.push({ entry, topic, questionIndex:index });
      }
    }
  }
  events.sort((a, b) => a.entry.at.localeCompare(b.entry.at));
  for (const { entry, reviewOf, reviewQuestionIndex, questionIndex, topic: initial } of events) {
    const topic = initial || origins.get(`${reviewOf}:${reviewQuestionIndex ?? 'whole'}`);
    if (!topic) continue;
    if (reviewOf) origins.set(`${entry.id}:whole`, topic);
    const day = calendarDay(entry.at, timeZone);
    if (day > today) continue;
    if (!reviewOf) {
      topic.source = entry; topic.reviewId = entry.id; topic.reviewQuestionIndex = questionIndex; topic.streak = 0;
      topic.lastCountedDay = day; topic.dueDate = addDays(day, 1);
    } else {
      topic.attempts++;
      if (!entry.feedback.correct) {
        topic.streak = 0; topic.lastCountedDay = day; topic.dueDate = addDays(day, 1);
      } else if (!entry.hintUsed && !entry.transcriptViewed && day > topic.lastCountedDay) {
        topic.streak = Math.min(3, topic.streak + 1); topic.lastCountedDay = day;
        topic.dueDate = addDays(day, [1, 3, 7, 14][topic.streak]);
      } else if (entry.hintUsed || entry.transcriptViewed) topic.dueDate = addDays(day, 1);
    }
    topic.lastPracticedAt = entry.at;
  }
  return [...topics.values()].filter(topic => topic.source).map(topic => ({ ...topic, due: topic.dueDate <= today,
    status: topic.streak >= 3 ? '已跨日独立巩固 3 次' : topic.dueDate <= today ? '到期复习' : '等待下次复习' }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.reviewId).localeCompare(String(b.reviewId)));
}

export function reviewOverview(state, timeZone = 'UTC', now = new Date()) {
  const plans = reviewPlan(state, timeZone, now), goals = {};
  for (const plan of plans) {
    goals[plan.goal] ||= { dueCount: 0, scheduledCount: 0, reinforcedCount: 0, items: [] };
    const bucket = goals[plan.goal]; bucket.scheduledCount++;
    if (plan.due) bucket.dueCount++;
    if (plan.streak >= 3) bucket.reinforcedCount++;
    if (bucket.items.length < 3) bucket.items.push({ reviewId: plan.reviewId, reviewQuestionIndex:plan.reviewQuestionIndex, skill: plan.skill, weakness: plan.weakness, dueDate: plan.dueDate, due: plan.due, streak: plan.streak, status: plan.status });
  }
  return goals;
}
