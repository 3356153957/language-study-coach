import test from 'node:test';
import assert from 'node:assert/strict';
import { prompts, validateTask, validateLearnerAnswer } from '../server/coach.js';
import { createEngine } from '../server/engine.js';
import { planImport } from '../server/backup.js';

const cet4 = { goal: '四级', mode: '综合', history: [] };
const bank = ['adopt', 'benefit', 'crucial', 'decline', 'efficient', 'flexible', 'gradually', 'highlight', 'impact', 'journey', 'keen', 'launch', 'maintain', 'notable', 'obtain'];
const passage = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1} has a blank (${i + 1})____ here.`).join(' ');
const cloze = (over = {}) => ({ kind: 'choice', skill: '阅读', level: 'B1', examPart: '选词填空', reason: '按四级选词填空练习', prompt: '阅读短文，从词库中为每个空选择一个词，每个词最多用一次。', passage, translation: '中文译文。', audio: '', options: [], answer: '', hint: '先判断词性。',
  questions: Array.from({ length: 10 }, (_, i) => ({ prompt: `第 ${i + 1} 空`, options: bank, answer: bank[i] })), ...over });
const letters = 'ABCDEFGHIJ'.split('');
const matching = (over = {}) => ({ kind: 'choice', skill: '阅读', level: 'B1', examPart: '长篇阅读', reason: '按四级长篇阅读练习', prompt: '每个陈述对应文中的一个段落，段落可重复选择。', passage: letters.map(l => `${l}) Paragraph ${l} about campus life.`).join('\n'), translation: '中文译文。', audio: '', options: [], answer: '', hint: '找同义改写。',
  questions: Array.from({ length: 10 }, (_, i) => ({ prompt: `Statement ${i + 1}.`, options: letters, answer: i < 2 ? 'A' : letters[i] })), ...over });
const careful = (over = {}) => ({ kind: 'choice', skill: '阅读', level: 'B1', examPart: '仔细阅读', reason: '按四级仔细阅读练习', prompt: '阅读短文，回答问题。', passage: 'A long passage about urban gardens and community life.', translation: '中文译文。', audio: '', options: [], answer: '', hint: '定位关键词。',
  questions: Array.from({ length: 5 }, (_, i) => ({ prompt: `Question ${i + 1}?`, options: ['one', 'two', 'three', 'four'].map(o => `${o} ${i}`), answer: `one ${i}` })), ...over });
const news = (over = {}) => ({ kind: 'listening', skill: '听力', level: 'B1', examPart: '短篇新闻', reason: '按四级短篇新闻练习', prompt: '听新闻，回答问题。', passage: '', translation: '', audio: 'A city library opened a new reading room on Monday. It stays open until midnight.', options: [], answer: '', hint: '注意时间。',
  questions: [{ prompt: 'What opened?', options: ['A reading room', 'A cafe', 'A gym', 'A school'], answer: 'A reading room' }, { prompt: 'Until when?', options: ['Noon', 'Midnight', '9 pm', '6 pm'], answer: 'Midnight' }], ...over });
const open = (examPart, prompt) => ({ kind: 'text', skill: '表达', level: 'B1', examPart, reason: `按四级${examPart}练习`, prompt, passage: '', translation: '', audio: '', options: [], answer: 'A reference answer.', hint: '先列提纲。' });

test('CET prompts name every exam part with its real-exam scale and gradual-length rule', () => {
  for (const prompt of [prompts.next, prompts.gradeAndNext]) {
    for (const part of ['选词填空', '长篇阅读', '仔细阅读', '短篇新闻', '长对话', '听力篇章', '讲座', '写作', '翻译', 'examPart']) assert.ok(prompt.includes(part), `prompt mentions ${part}`);
    for (const scale of ['120', '180', '140', '160', '150', '200']) assert.ok(prompt.includes(scale), `prompt states scale ${scale}`);
    assert.match(prompt, /逐步/);
  }
});

test('exam goals accept full-size CET parts and keep examPart on the task', () => {
  const book = validateTask(cloze(), cet4);
  assert.equal(book.examPart, '选词填空'); assert.equal(book.questions.length, 10); assert.equal(book.questions[0].options.length, 15);
  assert.equal(validateTask(matching(), cet4).questions.length, 10);
  assert.equal(validateTask(careful(), cet4).questions.length, 5);
  assert.equal(validateTask(news(), cet4).examPart, '短篇新闻');
  assert.equal(validateTask(open('写作', 'Write an essay of 120 to 180 words on the value of volunteering.'), cet4).examPart, '写作');
  assert.equal(validateTask(open('翻译', '将下面的段落翻译成英文：中国的茶文化历史悠久，喝茶不仅是一种习惯，也是一种待客之道。'), cet4).examPart, '翻译');
  assert.equal(validateTask(cloze({ questions: cloze().questions.slice(0, 5).map(q => ({ ...q, options: bank.slice(0, 8) })) }), cet4).questions.length, 5, 'a smaller cloze is allowed while lengths grow gradually');
});

test('exam goals reject tasks that do not follow the CET part rules', () => {
  const reject = (data, session = cet4) => assert.throws(() => validateTask(data, session), /题型|四级|六级|选项|问题|选词填空|长篇阅读|练习方式|作答形式/);
  const { examPart, ...plain } = careful(); reject(plain);
  reject(careful({ examPart: '完形填空' }));
  reject(cloze({ questions: cloze().questions.map((q, i) => ({ ...q, answer: bank[0] })) }));
  reject(cloze({ questions: cloze().questions.map((q, i) => ({ ...q, options: i ? bank : bank.slice(0, 14) })) }));
  reject(matching({ questions: matching().questions.map(q => ({ ...q, options: ['first', 'second', 'third'], answer: 'first' })) }));
  reject(careful({ questions: careful().questions.map(q => ({ ...q, options: q.options.slice(0, 3) })) }));
  reject(careful({ questions: [...careful().questions, careful().questions[0]] }));
  reject(news({ questions: news().questions.map(q => ({ ...q, options: q.options.slice(0, 3) })) }));
  reject(news(), { ...cet4, goal: '六级' });
  reject(news({ examPart: '讲座' }));
  reject(open('写作', 'Write an essay.'), { ...cet4, mode: '听力' });
  reject(careful(), { ...cet4, mode: '写作' });
});

test('non-exam goals keep the existing four-question and four-option limits', () => {
  const school = { goal: '高中英语', mode: '综合', history: [] };
  const { examPart, ...plain } = careful();
  assert.throws(() => validateTask(plain, school), /问题过多/);
  assert.throws(() => validateTask({ ...cloze(), examPart: undefined, questions: cloze().questions.slice(0, 2) }, school), /选项/);
  assert.equal(validateTask({ ...plain, questions: plain.questions.slice(0, 4) }, school).examPart, undefined);
});

test('a ten-blank cloze runs through answering, grading, backup and import', async () => {
  let calls = 0;
  const engine = createEngine({ initialState: { version: 1, config: { provider: 'compatible', baseURL: 'https://example.test/v1', model: 'm', apiKey: 'k' }, profiles: {}, sessions: [] }, save: async () => {},
    modelCall: async (config, prompt, ctx) => {
      calls++;
      if (prompt === prompts.next) return cloze();
      return { feedback: { correct: true, explanation: '全部正确。', suggestion: '', weakness: '' }, nextTask: matching() };
    } });
  let state = await engine.execute('/api/session/start', { goal: '四级', mode: '阅读' });
  const current = state.sessions[0].current;
  assert.equal(current.examPart, '选词填空');
  assert.ok(current.questions.every(q => q.options.length === 15 && q.answer === undefined), 'answers stay hidden before submission');
  const answer = JSON.stringify(bank.slice(0, 10));
  state = await engine.execute('/api/session/answer', { sessionId: state.sessions[0].id, taskId: current.id, answer });
  assert.equal(state.sessions[0].history[0].feedback.correct, true);
  const imported = planImport({ version: 1, sessions: [] }, JSON.parse(JSON.stringify(engine.backup()))).state;
  assert.equal(imported.sessions[0].history[0].task.examPart, '选词填空');
  assert.equal(imported.sessions[0].history[0].task.questions.length, 10);
  assert.doesNotThrow(() => validateLearnerAnswer(imported.sessions[0].history[0].task, answer));
});

test('reviewing a later blank of a ten-question part survives backup and import', async () => {
  const at = '2026-11-18T10:00:00.000Z';
  const source = validateTask(cloze(), { ...cet4, mode: '阅读' });
  const wrong = { id: 'wrong-cloze', at, askedAt: at, task: { ...source, id: 'cloze-task' }, answer: JSON.stringify(bank.slice(0, 10).map((w, i) => i === 7 ? bank[12] : w)),
    feedback: { correct: false, explanation: '第 8 空错误。', suggestion: '', weakness: '形容词辨析' }, activeSeconds: 60 };
  const old = { id: 'old', goal: '四级', mode: '阅读', targetCount: 5, startedAt: at, finishedAt: at, history: [wrong], current: null };
  const engine = createEngine({ initialState: { version: 1, config: { provider: 'compatible', apiKey: 'k' }, sessions: [old] }, save: async () => {},
    modelCall: async () => cloze({ questions: cloze().questions.slice(0, 6).map((q, i) => ({ ...q, prompt: `第 ${i + 1} 空`, options: bank.slice(3, 13), answer: bank[i + 3] })) }) });
  await engine.execute('/api/session/start', { goal: '四级', mode: '阅读', reviewId: wrong.id, reviewQuestionIndex: 7 });
  const imported = planImport({ version: 1, sessions: [] }, JSON.parse(JSON.stringify(engine.backup()))).state;
  assert.equal(imported.sessions.at(-1).reviewQuestionIndex, 7);
});

test('banked cloze grows its word bank gradually but always keeps at least two distractors', () => {
  for (const prompt of [prompts.next, prompts.gradeAndNext]) assert.match(prompt, /备选词[^。]*逐步增加/);
  const small = (blanks, words) => cloze({ questions: Array.from({ length: blanks }, (_, i) => ({ prompt: `第 ${i + 1} 空`, options: bank.slice(0, words), answer: bank[i] })) });
  assert.equal(validateTask(small(5, 7), cet4).questions[0].options.length, 7, 'five blanks with seven words is a valid starting size');
  assert.throws(() => validateTask(small(5, 6), cet4), /干扰/);
  assert.throws(() => validateTask(small(5, 5), cet4), /干扰/);
  assert.equal(validateTask(small(10, 15), cet4).questions.length, 10);
});
