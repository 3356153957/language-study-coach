import { normalizeWord } from '../server/vocabulary.js';

export function renderReadingPassage({ passage, taskId, sessionId, marks = [], esc, interactive = true }) {
  const marked = new Set(marks.filter(m => m.taskId === taskId && m.status !== 'removed').map(m => m.word));
  const content = String(passage || '').split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g).map((part,index) => {
    if (index % 2 === 0 || !interactive || part.length > 80) return esc(part);
    const word = normalizeWord(part), selected = marked.has(word);
    return `<button type="button" class="reading-word ${selected ? 'marked' : ''}" data-action="mark-word" data-word="${esc(word)}" data-id="${esc(sessionId)}" data-task="${esc(taskId)}" data-status="${selected ? 'removed' : 'learning'}" aria-label="${esc(word)}，${selected ? '取消标记' : '标记为不认识'}" aria-pressed="${selected}">${esc(part)}</button>`;
  }).join('');
  return `<div class="reading-passage reading-word-picker" lang="en">${content}</div>${interactive ? `<p class="word-picker-help">点单词加入单词本，再点可取消${marked.size ? ` · 已标记 ${marked.size} 个词` : ''}</p>` : ''}`;
}

export function renderWordbook({ data, esc, button, query = '', filter = 'learning' }) {
  const all = data.wordbook || [], learning = all.filter(w => w.status === 'learning').length;
  const items = all.filter(w => (filter === 'all' || w.status === filter) && (w.word.includes(query.trim().toLowerCase()) || (w.meaning || '').includes(query.trim())));
  return `<section class="wordbook-page progress-page"><div class="dash-heading"><div><span class="dash-date">从阅读中积累，放回句子里记</span><h1>单词本</h1></div>${button('返回学习','home','secondary-button')}</div>
    <p class="activity-lead">待学习 <strong>${learning}</strong> 个 · 已掌握 <strong>${all.length-learning}</strong> 个</p>
    <div class="wordbook-tools"><label class="wordbook-search">搜索单词<input id="wordbook-search" type="search" value="${esc(query)}" placeholder="搜索英文或中文" autocomplete="off"></label><label>显示<select id="wordbook-filter">${[['learning','待学习'],['mastered','已掌握'],['all','全部']].map(([value,label])=>`<option value="${value}" ${filter===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <div class="wordbook-list">${items.length ? items.map(item=>`<article class="wordbook-entry"><header><h2 lang="en">${esc(item.word)}</h2><span class="skill-tag">${item.status==='mastered'?'已掌握':'待学习'} · ${item.count} 篇标记</span></header><div class="word-meaning" lang="zh-CN">${item.meaning ? esc(item.meaning) : `<span class="word-meaning-pending">中文释义待补充</span>${button(data.configured?'获取中文释义':'连接 AI 获取释义',data.configured?'word-define':'settings','text-button',`data-word="${esc(item.word)}"`)}`}</div>${item.sources.map(source=>`<blockquote lang="en">${esc(source.context)}</blockquote>${source.translation?`<p class="word-context-translation" lang="zh-CN">${esc(source.translation)}</p>`:''}<button class="text-button" data-action="word-source" data-id="${esc(source.sessionId)}">${esc(source.goal)} · 查看原文 ↗</button>`).join('')}<div class="wordbook-actions">${button(item.status==='mastered'?'重新学习':'标记已掌握','word-status','secondary-button',`data-word="${esc(item.word)}" data-status="${item.status==='mastered'?'learning':'mastered'}"`)}${button('移出单词本','word-status','text-button',`data-word="${esc(item.word)}" data-status="removed"`)}</div></article>`).join('') : `<div class="empty-state"><h2>${all.length ? '没有符合条件的单词' : '把阅读中的生词收在这里'}</h2><p>${all.length ? '试试其他搜索词或切换显示范围。' : '阅读时直接点击不认识的英文单词，原句会一起保存。'}</p>${button('去阅读练习','practice','secondary-button','data-mode="阅读"')}</div>`}</div></section>`;
}
