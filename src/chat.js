import { modeName } from './icons.js';
export function discussionTarget(session, draft) {
  return session.history.find(entry => entry.task.id === draft.discussTaskId)?.task || session.current;
}

export function isDiscussing(session, draft) {
  return !!session.feedback || draft.composerMode === 'coach' || discussionTarget(session, draft).id !== session.current.id;
}

export function renderLearningChat({ session: s, draft, busy, pendingChat, esc, button, audioState, voiceMessage, speed, recognition }) {
  if (!s) return `<div class="empty-state"><h2>没有正在进行的练习</h2>${button('回到学习页', 'home')}</div>`;
  const types = { choice: '选择题', text: '文字表达', conversation: '情境对话', listening: '听力练习' };
  const row = (role, label, body, extra = '') => `<article class="chat-message ${role === 'user' ? 'from-user' : 'from-coach'}" ${extra}><span class="chat-avatar" aria-hidden="true">${role === 'user' ? '我' : 'L'}</span><div class="chat-message-content"><div class="chat-speaker">${esc(label)}</div><div class="chat-bubble">${body}</div></div></article>`;
  const text = content => `<p class="chat-text">${esc(content)}</p>`;
  function audio(task, active) {
    if (!task.audio) return '';
    if (!active) return `<details class="chat-material"><summary>听力原文</summary>${text(task.audio)}</details>`;
    return `<div class="audio-panel"><div class="audio-heading"><span class="audio-glyph" aria-hidden="true">◖))</span><div><strong>听一段英语</strong><small>先倒数，再读正文 · 可暂停、重播</small></div></div><div class="audio-actions">${button(audioState === 'loading' ? '取消播放' : audioState === 'playing' ? '暂停' : audioState === 'paused' ? '继续播放' : '播放听力', 'audio', 'secondary-button')}${button('重新播放', 'replay', 'text-button')}<label>语速<select id="audio-speed" aria-label="听力语速" ${busy ? 'disabled' : ''}>${[.75, 1, 1.25].map(v => `<option value="${v}" ${v === speed ? 'selected' : ''}>${v}×</option>`).join('')}</select></label></div><p class="field-help" id="audio-status" aria-live="polite">${audioState === 'loading' ? '正在启动声音…' : audioState === 'playing' ? '正在播放 · 倒数后开始正文' : audioState === 'paused' ? '已暂停' : '点击播放，听到倒数后开始听题'}</p>${button(draft.transcriptViewed ? '听力原文已展开' : '看原文（会记录辅助使用）', 'transcript', 'text-button')}${draft.transcriptViewed || s.feedback ? `<p class="transcript" lang="en">${esc(task.audio)}</p>` : ''}</div>`;
  }
  function question(task, entry, index) {
    const active = task.id === s.current.id, feedback = entry?.feedback;
    const chosen = entry?.answer || (active ? draft.answer : '');
    return row('coach', `英语教练 · 第 ${index + 1} 题`, `<div class="chat-question-meta"><span class="skill-tag">${esc(task.skill)} · ${esc(task.level)}</span><span>${types[task.kind]}</span>${button('追问这题', 'discuss-task', 'text-button', `data-id="${esc(task.id)}"`)}</div>${task.passage ? `<div class="reading-passage" lang="en">${esc(task.passage)}</div>` : ''}${audio(task, active)}<h2 class="task-prompt">${esc(task.prompt)}</h2>
      ${task.options.length ? `<div class="exercise-options" role="group" aria-label="选择答案">${task.options.map((option, i) => `<button class="exercise-option ${chosen === option ? 'selected' : ''} ${feedback && task.answer === option ? 'correct' : feedback && chosen === option && !feedback.correct ? 'wrong' : ''}" data-action="answer-option" data-index="${i}" aria-pressed="${chosen === option}" ${busy || !active || feedback ? 'disabled' : ''}><span>${String.fromCharCode(65 + i)}</span><strong>${esc(option)}</strong></button>`).join('')}</div>` : ''}
      ${active && !feedback ? `<div class="chat-hint">${button(draft.hintUsed ? '提示已展开' : '给我一点提示', 'hint', 'text-button')}${draft.hintUsed ? text(task.hint) : ''}</div>` : ''}
      <details class="chat-reason"><summary>为什么练这道题</summary>${text(task.reason)}</details>`, `data-question-id="${esc(task.id)}"`);
  }
  function feedback(entry) {
    const f = entry.feedback;
    return row('coach', '英语教练', `<span class="chat-result ${f.correct ? 'positive' : 'improve'}">${f.correct ? '回答正确' : '一起改得更准确'}</span>${text(f.explanation)}${f.suggestion ? `<div class="chat-revision"><strong>你的表达，优化后</strong><p lang="en">${esc(f.suggestion)}</p></div>` : ''}${!f.correct ? `<details class="chat-material"><summary>${entry.task.options.length ? '查看参考答案' : '看看另一种参考表达'}</summary>${text(entry.task.answer)}</details>` : ''}`);
  }
  const events = [];
  const add = (at, html) => events.push({ at: at || s.startedAt, html });
  s.history.forEach((entry, index) => {
    add(entry.askedAt || s.history[index - 1]?.at || s.startedAt, question(entry.task, entry, index));
    add(entry.at, row('user', '你', text(entry.answer)));
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
  return `<section class="session-page chat-session"><header class="chat-session-header"><div>${button('← 学习', 'home', 'back-button')}<h1>${esc(s.goal)} · ${s.placement ? '初步测评' : esc(modeName(s.mode)) + '练习'}</h1><span class="chat-progress">${progress} / ${s.targetCount}</span></div>${button(s.history.length ? '结束并生成小结' : '结束本轮', 'finish', 'text-button')}</header>
    <div class="chat-log" id="chat-log" role="log" aria-label="学习对话" aria-live="polite" aria-relevant="additions">${events.map(event => event.html).join('')}</div>
    <div class="chat-bottom">${s.feedback ? `<div class="chat-next-row"><span>${s.nextReady ? '下一题已准备好' : s.nextPreparationError || '回答已保存'}</span>${button(s.history.length >= s.targetCount ? '生成学习小结 →' : '继续下一题 →', s.history.length >= s.targetCount ? 'finish' : 'next', 'secondary-button')}</div>` : ''}
      <form id="chat-composer" class="chat-composer"><div class="composer-header"><div class="composer-modes" aria-label="输入用途">${!s.feedback ? `${button('作答', 'composer-answer', `composer-mode ${!discussing ? 'selected' : ''}`, `aria-pressed="${!discussing}"`)}${button('问教练', 'composer-coach', `composer-mode ${discussing ? 'selected' : ''}`, `aria-pressed="${discussing}"`)}` : '<strong>继续和教练聊</strong>'}</div><span>${discussing ? `讨论第 ${targetNumber} 题 · 中文或英文都可以` : '先想一想，再用英语回答'}</span></div>
      ${discussing ? `<label class="sr-only" for="coach-message">给教练的消息</label><textarea id="coach-message" maxlength="2000" placeholder="比如：我想表达的是，提前把盘子摆在桌子上……" ${busy ? 'disabled' : ''}>${esc(draft.coachMessage)}</textarea>` : s.current.options.length ? `<p class="composer-choice">${draft.answer ? `已选择：${esc(draft.answer)}` : '点击上方题卡选择答案，也可以先问教练。'}</p>` : `<label class="sr-only" for="answer-text">你的回答</label><textarea id="answer-text" maxlength="4000" placeholder="用英语表达你的想法……" ${busy ? 'disabled' : ''}>${esc(draft.answer)}</textarea>`}
      <div class="composer-tools"><div>${discussing || !s.current.options.length ? button(recognition ? '停止录音' : '语音输入', 'voice', 'voice-button', `data-field="${discussing ? 'coachMessage' : 'answer'}"`) : ''}<span class="voice-status" id="voice-status" aria-live="polite">${esc(voiceMessage || (discussing ? '澄清意思、问语法，随时聊。' : '转写后可修改，再提交。'))}</span></div>${button(discussing ? '发送给教练 ↑' : '提交回答 ↑', discussing ? 'send-coach' : 'submit', 'primary-button', (discussing ? draft.coachMessage : draft.answer)?.trim() ? '' : 'disabled')}</div>
      ${busy && !pendingChat ? `<p class="chat-thinking" role="status"><span class="spinner"></span>${esc(busy)}</p>` : ''}</form>
    </div></section>`;
}
