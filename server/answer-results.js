// Existing records remain readable; only independently graded subquestions are
// counted separately. Old open answers without item feedback retain their score.
export function questionResults(task, answer, feedback, skippedQuestions = []) {
  const questions = task?.questions;
  if (!Array.isArray(questions) || questions.length < 2) return null;
  if (questions.every(q => q.options?.length)) {
    let values; try { values = JSON.parse(answer); } catch { return null; }
    if (!Array.isArray(values) || values.length !== questions.length) return null;
    return questions.map((q, i) => ({ correct: !skippedQuestions.includes(i) && values[i] === q.answer }));
  }
  return feedback?.questions?.length === questions.length && feedback.questions.every(q => typeof q.correct === 'boolean') ? feedback.questions : null;
}

export function answerCounts(entry) {
  const results = questionResults(entry.task, entry.answer, entry.feedback, entry.skippedQuestions);
  return results ? { count: results.length, correct: results.filter(q => q.correct).length }
    : { count: 1, correct: Number(!!entry.feedback?.correct) };
}

export function independentCounts(entry) {
  if (entry.hintUsed || entry.transcriptViewed) return { count: 0, correct: 0 };
  const score = answerCounts(entry);
  return { count: Math.max(0, score.count - (entry.skippedQuestions?.length || 0)), correct: score.correct };
}

export function roundCounts(history) {
  return history.reduce((total, entry) => { const score = answerCounts(entry); return { count: total.count + score.count, correct: total.correct + score.correct }; }, { count: 0, correct: 0 });
}
