import { renderReadingPassage } from './reading-words.js';
import { renderRevisionHistory } from './answer-review.js';
import { answerCounts } from '../server/answer-results.js';
import { modeName } from './icons.js';
export function discussionTarget(session, draft) {
  return session.history.find(entry => entry.task.id === draft.discussTaskId)?.task || session.current;
}

export function isDiscussing(session, draft) {
  return !!session.feedback || draft.composerMode === 'coach' || discussionTarget(session, draft).id !== session.current.id;
}

function taskQuestions(task) {
  return task.questions?.length ? task.questions : [{ prompt: task.prompt, options: task.options || [], answer: task.answer }];
}

function selectedAnswers(value, count) {
  if (count === 1) return [value || ''];
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) && parsed.length === count ? parsed : Array(count).fill('');
  } catch { return Array(count).fill(''); }
}

function answerComplete(task, value, skippedQuestions = []) {
  const items = taskQuestions(task);
  if (items.length === 1) return !!String(value || '').trim() || skippedQuestions.includes(0);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) && parsed.length === items.length && parsed.every((answer, i) => typeof answer === 'string' && (skippedQuestions.includes(i) || !!answer.trim() && (!items[i].options.length || items[i].options.includes(answer))));
  } catch { return false; }
}

function answerText(task, value, skippedQuestions = []) {
  const items = taskQuestions(task);
  if (items.length === 1) return value || '';
  try {
    const values = JSON.parse(value || '[]');
    return values.map((answer, index) => `${index + 1}. ${answer || (skippedQuestions.includes(index) ? '未作答（已标记不会）' : items[index].options.length ? '未选择':'未填写')}`).join('\n');
  } catch { return value || ''; }
}

const chatRow = (role, label, body, esc, extra = '') => `<article class="chat-message ${role === 'user' ? 'from-user' : 'from-coach'}" ${extra}><span class="chat-avatar" aria-hidden="true">${role === 'user' ? '我' : 'L'}</span><div class="chat-message-content"><div class="chat-speaker">${esc(label)}</div><div class="chat-bubble">${body}</div></div></article>`;
const chatText = (content, esc) => `<p class="chat-text">${esc(content)}</p>`;

const starters = [
  ['今天只想聊聊', '今天没什么动力，只想和你聊聊。'],
  ['这些题我不想做', '最近出的题我不太想做，想聊聊怎么换个方式学。'],
  ['用喜欢的话题练一句', '我想用自己感兴趣的话题练一句英语。'],
];

export function renderCoachConversation({ turns, goal, savedPreference, message, pending, busy, configured, fromPractice, esc, button }) {
  const user = value => chatRow('user', '你', chatText(value, esc), esc);
  const coach = (value, extra = '') => chatRow('coach', '英语教练', chatText(value, esc) + extra, esc);
  const proposal = turns.findLast(turn => turn.goal === goal && turn.practicePreference);
  const preferenceCard = proposal && proposal.practicePreference !== savedPreference ? `<div class="chat-revision coach-preference">
    <strong>${esc(goal)}综合练习建议</strong>${chatText(proposal.practicePreference, esc)}
    ${button('应用到综合练习', 'coach-apply-preference', 'secondary-button', `data-id="${esc(proposal.id)}"`)}
  </div>` : '';
  return `<section class="chat-session coach-conversation"><header class="chat-session-header">
    <div>${button(fromPractice ? '← 返回练习' : '← 学习', fromPractice ? 'session' : 'home', 'back-button')}<h1>和教练聊</h1></div>
  </header>
  <div class="chat-log" id="coach-log" role="log" aria-label="教练对话">
    ${turns.length ? turns.map(turn => user(turn.message) + coach(turn.reply, turn === proposal ? preferenceCard : '')).join('') : coach('今天想聊什么？可以说说题目哪里没意思，也可以告诉我以后想多练什么。')}
    ${pending ? user(pending) : ''}
    ${busy ? `<p class="chat-thinking" role="status"><span class="spinner"></span>${esc(busy)}</p>` : ''}
  </div>
  <div class="chat-bottom">${savedPreference ? `<details class="coach-saved-preference">
    <summary>${esc(goal)}出题偏好已应用</summary>${chatText(savedPreference, esc)}
    ${button('恢复默认出题', 'coach-clear-preference', 'text-button')}
  </details>` : ''}${configured ? `<form id="coach-chat-form" class="chat-composer">
    <div class="coach-starters" aria-label="聊天开场">${!turns.length && !pending ? starters.map(([label, value]) => button(label, 'coach-starter', 'secondary-button', `data-value="${esc(value)}"`)).join('') : ''}</div>
    <label class="sr-only" for="free-coach-message">给教练的消息</label>
    <textarea id="free-coach-message" maxlength="2000" placeholder="想说什么，中文或英文都可以…" ${busy ? 'disabled' : ''}>${pending ? '' : esc(message)}</textarea>
    <div class="composer-tools"><span class="coach-chat-note">自由聊天 · 不计分</span><button type="submit" class="primary-button" ${busy || !message.trim() ? 'disabled' : ''}>发送 ↑</button></div>
  </form>` : `<div class="chat-composer"><p>连接学习模型后，就可以直接和教练聊。</p>${button('去设置连接 AI', 'settings', 'secondary-button')}</div>`}</div>
  </section>`;
}

export function renderLearningChat({ session: s, draft, busy, pendingChat, esc, button, audioState, voiceMessage, speed, recognition, usesChatGPT }) {
  if (!s) return `<div class="empty-state"><h2>没有正在进行的练习</h2>${button('回到学习页', 'home')}</div>`;
  const types = { choice: '选择题', text: '文字表达', conversation: '情境对话', listening: '听力练习' };
  const row = (role, label, body, extra) => chatRow(role, label, body, esc, extra);
  const text = content => chatText(content, esc);
  function audio(task, active) {
    if (!task.audio) return '';
    if (!active) return `<details class="chat-material"><summary>听力原文</summary>${text(task.audio)}</details>`;
    return `<div class="audio-panel"><div class="audio-heading"><span class="audio-glyph" aria-hidden="true">◖))</span><div><strong>听一段英语</strong><small>先倒数，再读正文 · 可暂停、重播</small></div></div><div class="audio-actions">${button(audioState === 'loading' ? '取消播放' : audioState === 'playing' ? '暂停' : audioState === 'paused' ? '继续播放' : '播放听力', 'audio', 'secondary-button')}${button('重新播放', 'replay', 'text-button')}<label>语速<select id="audio-speed" aria-label="听力语速" ${busy ? 'disabled' : ''}>${[.75, 1, 1.25].map(v => `<option value="${v}" ${v === speed ? 'selected' : ''}>${v}×</option>`).join('')}</select></label></div><p class="field-help" id="audio-status" aria-live="polite">${audioState === 'loading' ? '正在启动声音…' : audioState === 'playing' ? '正在播放 · 倒数后开始正文' : audioState === 'paused' ? '已暂停' : '点击播放，听到倒数后开始听题'}</p>${button(draft.transcriptViewed ? '听力原文已展开' : '看原文（会记录辅助使用）', 'transcript', 'text-button')}${draft.transcriptViewed || s.feedback ? `<p class="transcript" lang="en">${esc(task.audio)}</p>` : ''}</div>`;
  }
  // A shared list of more than four words (CET banked cloze) is shown once; each blank then picks a letter.
  function wordBank(items) {
    const bank = items[0]?.options || [];
    const same = item => item.options.length === bank.length && item.options.every((option, i) => option === bank[i]);
    if (bank.length <= 4 || !items.every(same) || bank.every((option, i) => option === String.fromCharCode(65 + i))) return '';
    return `<div class="word-bank" role="list" aria-label="词库"><span class="word-bank-title">词库</span>${bank.map((option, i) => `<span role="listitem"><b>${String.fromCharCode(65 + i)}</b>${esc(option)}</span>`).join('')}</div>`;
  }
  function question(task, entry, index) {
    const active = task.id === s.current.id, feedback = entry?.feedback;
    const items = taskQuestions(task), chosen = selectedAnswers(entry?.answer || (active ? draft.answer : ''), items.length);
    const itemHtml = items.map((item, questionIndex) => `${items.length > 1 ? `<h3 class="task-subprompt">${questionIndex + 1}. ${esc(item.prompt)}${item.options.length > 4 && chosen[questionIndex] ? `<span class="picked-word">已选：${esc(chosen[questionIndex])}</span>` : ''}</h3>` : `<h2 class="task-prompt">${esc(item.prompt)}</h2>`}
      ${item.options.length ? `<div class="exercise-options${item.options.length > 4 ? ' compact' : ''}" role="group" aria-label="第 ${questionIndex + 1} 小题选项">${item.options.map((option, optionIndex) => { const picked = chosen[questionIndex] === option; const right = feedback && item.answer === option; const wrong = feedback && picked && !right; return `<button class="exercise-option ${picked ? 'selected' : ''} ${right ? 'correct' : ''} ${wrong ? 'wrong' : ''}" data-action="answer-option" data-question-index="${questionIndex}" data-index="${optionIndex}" aria-pressed="${picked}" ${item.options.length > 4 ? `aria-label="${String.fromCharCode(65 + optionIndex)}. ${esc(option)}" title="${esc(option)}"` : ''} ${busy || !active || feedback ? 'disabled' : ''}><span>${String.fromCharCode(65 + optionIndex)}</span>${item.options.length > 4 ? '' : `<strong>${esc(option)}</strong>`}</button>`; }).join('')}</div>` : items.length > 1 && active && !feedback ? `<label class="sr-only" for="task-answer-${questionIndex}">${questionIndex + 1}. ${esc(item.prompt)}</label><textarea id="task-answer-${questionIndex}" class="task-text-answer" data-question-index="${questionIndex}" maxlength="4000" placeholder="用英语回答第 ${questionIndex + 1} 个问题" ${busy ? 'disabled' : ''}>${esc(chosen[questionIndex] || '')}</textarea><div class="answer-field-tools">${button('换行', 'answer-newline', 'secondary-button', `data-field="task-answer-${questionIndex}"`)}${questionIndex + 1 < items.length ? button('下一答题格 →', 'answer-next-field', 'secondary-button', `data-field="task-answer-${questionIndex}" data-next="task-answer-${questionIndex + 1}"`) : ''}</div>` : ''}${active && !feedback ? `<div class="answer-field-tools">${!item.options.length && items.length>1 ? button('语音输入','voice','text-button',`data-question-index="${questionIndex}"`) : ''}${button(draft.skippedQuestions?.includes(questionIndex) ? '取消不会标记' : items.length>1 ? '这问不会' : '这题不会','skip-question','text-button',`data-question-index="${questionIndex}" aria-pressed="${!!draft.skippedQuestions?.includes(questionIndex)}"`)}${draft.skippedQuestions?.includes(questionIndex) ? '<span class="skip-note">已标记未作答，可继续提交</span>' : ''}</div>` : ''}`).join('');
    return row('coach', `英语教练 · 第 ${index + 1} 组`, `<div class="chat-question-meta"><span class="skill-tag">${esc(task.skill)} · ${esc(task.level)}</span><span>${task.examPart ? `真题题型 · ${esc(task.examPart)}` : types[task.kind]}${items.length > 1 ? ` · ${items.length} 小题` : ''}</span>${button('追问这题', 'discuss-task', 'text-button', `data-id="${esc(task.id)}"`)}</div>${items.length > 1 || items[0].prompt !== task.prompt ? text(task.prompt) : ''}${task.passage ? `${renderReadingPassage({passage:task.passage,taskId:task.id,sessionId:s.id,marks:s.wordMarks,esc})}${(feedback || !active) && task.translation ? `<div class="reading-translation" lang="zh-CN"><span>中文译文</span><p>${esc(task.translation)}</p></div>` : ''}` : ''}${audio(task, active)}${wordBank(items)}${itemHtml}
      ${active && !feedback ? `<div class="chat-hint">${button(draft.hintUsed ? '提示已展开' : '给我一点提示', 'hint', 'text-button')}${draft.hintUsed ? text(task.hint) : ''}</div>` : ''}
      <details class="chat-reason"><summary>为什么练这道题</summary>${text(task.reason)}</details>`, `data-question-id="${esc(task.id)}"`);
  }
  function feedback(entry) {
    const f = entry.feedback, score = answerCounts(entry);
    const resultLabel = score.count > 1 ? `本组答对 ${score.correct} / ${score.count} 小题` : f.correct ? '回答正确' : '一起改得更准确';
    return row('coach', '英语教练', `<span class="chat-result ${f.correct ? 'positive' : 'improve'}">${esc(resultLabel)}</span>${text(f.explanation)}${f.questions?.map((q, i) => `<section class="feedback-item"><p class="chat-text">${i + 1}. ${entry.skippedQuestions?.includes(i) ? '未作答' : q.correct ? '答对' : '再巩固'} · ${esc(q.explanation || '')}</p>${q.suggestion ? `<div class="chat-revision"><strong>根据第 ${i+1} 项原句调整</strong><p lang="en">${esc(q.suggestion)}</p></div>` : ''}</section>`).join('') || ''}${button((entry.revisions?.length || 0)>=3 ? '已复核 3/3 次' : `复核这次批改（${entry.revisions?.length || 0}/3）`, 'regrade', 'text-button', `data-id="${esc(entry.task.id)}" ${(entry.revisions?.length || 0)>=3 ? 'disabled' : ''}`)}${renderRevisionHistory(entry,esc)}${f.suggestion ? `<div class="chat-revision"><strong>你的表达，优化后</strong><p lang="en">${esc(f.suggestion)}</p></div>` : ''}${!f.correct ? `<details class="chat-material"><summary>${entry.task.options.length ? '查看参考答案' : '看看另一种参考表达'}</summary>${taskQuestions(entry.task).map((q, i) => text(`${taskQuestions(entry.task).length > 1 ? `${i + 1}. ` : ''}${q.answer || ''}`)).join('')}</details>` : ''}`);
  }
  const events = [];
  const add = (at, html) => events.push({ at: at || s.startedAt, html });
  s.history.forEach((entry, index) => {
    add(entry.askedAt || s.history[index - 1]?.at || s.startedAt, question(entry.task, entry, index));
    add(entry.at, row('user', '你', text(answerText(entry.task, entry.answer, entry.skippedQuestions) || (entry.skippedQuestions?.length ? '未作答（已标记不会）' : ''))));
    add(entry.at, feedback(entry));
  });
  if (!s.history.some(entry => entry.task.id === s.current.id)) add(s.currentAskedAt || s.history.at(-1)?.at || s.startedAt, question(s.current, null, s.history.length));
  for (const [taskId, turns] of Object.entries(s.discussions || {})) {
    const index = s.history.findIndex(entry => entry.task.id === taskId);
    const number = index < 0 ? s.history.length + 1 : index + 1;
    for (const turn of turns) {
      add(turn.at, row('user', `你 · 追问第 ${number} 题`, text(turn.message)));
      add(turn.at, row('coach', '英语教练', text(turn.reply)));
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  if (pendingChat) {
    events.push({ html: row('user', '你', text(pendingChat.text)) });
    events.push({ html: row('coach', '英语教练', `<div class="chat-thinking" role="status"><span class="spinner"></span>${esc(busy)}</div>`) });
  }
  const target = discussionTarget(s, draft), discussing = isDiscussing(s, draft);
  const targetIndex = s.history.findIndex(entry => entry.task.id === target.id);
  const targetNumber = targetIndex < 0 ? s.history.length + 1 : targetIndex + 1;
  const progress = Math.min(s.history.length + (s.feedback ? 0 : 1), s.targetCount);
  return `<section class="session-page chat-session"><header class="chat-session-header"><div>${button('← 学习', 'home', 'back-button')}<h1>${esc(s.goal)} · ${s.placement ? '初步测评' : esc(modeName(s.mode)) + '练习'}</h1><span class="chat-progress">第 ${progress} / ${s.targetCount} 组</span></div>${button(s.history.length ? '结束并生成小结' : '结束本轮', 'finish', 'text-button')}</header>
    <div class="practice-subheader"><p class="field-help practice-timing"><span id="practice-timer">本题前台用时 ${Math.floor((draft.activeSeconds || 0)/60)} 分 ${(draft.activeSeconds || 0)%60} 秒</span> · ${button(draft.timerPaused ? '继续计时' : '暂停计时','timer-toggle','text-button')}<small>离开页面自动暂停；每题最多 30 分钟</small></p>${button('先和教练聊聊', 'open-coach', 'secondary-button')}</div>
    <div class="chat-log" id="chat-log" role="log" aria-label="学习对话" aria-live="polite" aria-relevant="additions">${events.map(event => event.html).join('')}</div>
    <div class="chat-bottom">${usesChatGPT?'<p class="subscription-note">正在使用 ChatGPT 订阅 <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理用量 ↗</a></p>':''}${s.feedback ? `<div class="chat-next-row"><span>${s.nextReady ? '下一题已准备好' : s.nextPreparationError || '回答已保存'}</span>${button(s.history.length >= s.targetCount ? '生成学习小结 →' : '继续下一题 →', s.history.length >= s.targetCount ? 'finish' : 'next', 'secondary-button')}</div>` : ''}
      <form id="chat-composer" class="chat-composer"><div class="composer-header"><div class="composer-modes" aria-label="输入用途">${!s.feedback ? `${button('作答', 'composer-answer', `composer-mode ${!discussing ? 'selected' : ''}`, `aria-pressed="${!discussing}"`)}${button('问教练', 'composer-coach', `composer-mode ${discussing ? 'selected' : ''}`, `aria-pressed="${discussing}"`)}` : '<strong>继续和教练聊</strong>'}</div><span>${discussing ? `讨论第 ${targetNumber} 题 · 中文或英文都可以` : '先想一想，再用英语回答'}</span></div>
      ${discussing ? `<label class="sr-only" for="coach-message">给教练的消息</label><textarea id="coach-message" maxlength="2000" placeholder="比如：我想表达的是，提前把盘子摆在桌子上……" ${busy ? 'disabled' : ''}>${esc(draft.coachMessage)}</textarea>` : taskQuestions(s.current).length > 1 ? `<p class="composer-choice">每个问题各填一格；不会的小题可标记后提交。</p>` : taskQuestions(s.current).some(item => item.options.length) ? `<p class="composer-choice">${draft.answer ? '已完成部分选择' : '点击上方题卡选择答案，也可以先问教练。'}</p>` : `<label class="sr-only" for="answer-text">你的回答</label><textarea id="answer-text" maxlength="4000" placeholder="用英语表达你的想法……" ${busy ? 'disabled' : ''}>${esc(draft.answer)}</textarea>`}
      <div class="composer-tools"><div>${discussing || (taskQuestions(s.current).length === 1 && !taskQuestions(s.current).some(item => item.options.length)) ? button(recognition ? '停止录音' : '语音输入', 'voice', 'voice-button', `data-field="${discussing ? 'coachMessage' : 'answer'}"`) : ''}${discussing || (taskQuestions(s.current).length === 1 && !taskQuestions(s.current).some(item => item.options.length)) ? button('换行', 'answer-newline', 'secondary-button', `data-field="${discussing ? 'coach-message' : 'answer-text'}"`) : ''}<span class="voice-status" id="voice-status" aria-live="polite">${esc(voiceMessage || (discussing ? '澄清意思、问语法，随时聊。' : '转写后可修改，再提交。'))}</span></div>${button(discussing ? '发送给教练 ↑' : '提交回答 ↑', discussing ? 'send-coach' : 'submit', 'primary-button', (discussing ? draft.coachMessage : answerComplete(s.current, draft.answer, draft.skippedQuestions)) ? '' : 'disabled')}</div>
      ${busy && !pendingChat ? `<p class="chat-thinking" role="status"><span class="spinner"></span>${esc(busy)}</p>` : ''}</form>
    </div></section>`;
}
