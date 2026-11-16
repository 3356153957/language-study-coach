export function predictionFixture() {
  const at = '2026-11-14T10:00:00.000Z';
  const estimate = { low: 30, high: 60, reason: '历史练习的初步估计，仍需补充考试材料。' };
  const report = { level: 'B1', summary: '学习观察', nextFocus: '继续阅读与听力', skills: ['阅读', '听力', '词汇', '语法', '表达'].map(name => ({ name, level: 'B1', evidence: '练习记录' })), examEstimate: estimate };
  const sessions = Array.from({ length: 5 }, (_, round) => ({
    id: `round-${round}`, goal: '四级', mode: '综合', targetCount: 5, startedAt: at, finishedAt: at, current: null, feedback: null,
    history: Array.from({ length: 5 }, (_, n) => {
      const id = `entry-${round}-${n}`, skill = ['阅读', '听力', '表达'][(round * 5 + n) % 3];
      return { id, at, askedAt: at, answer: 'On the table.', feedback: { correct: true, explanation: '正确', suggestion: '', weakness: '' },
        task: { id: `task-${id}`, kind: skill === '听力' ? 'listening' : 'text', skill, level: 'B1', reason: '练习理解', prompt: 'Where are the plates?', options: skill === '听力' ? ['On the table.', 'On the desk.'] : [], answer: 'On the table.', hint: '留意位置。', passage: skill === '阅读' ? 'The plates are on the table.' : '', audio: skill === '听力' ? 'The plates are on the table.' : '' } };
    }), ...(round === 4 ? { report } : {}),
  }));
  return { version: 1, config: null, sessions, examEstimates: { 四级: { ...estimate, updatedAt: at } } };
}
