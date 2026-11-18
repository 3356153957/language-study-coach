import { questionResults } from '../server/answer-results.js';

export function renderAnswerReview(entry, esc) {
  const task=entry.task, questions=task.questions?.length ? task.questions : [{prompt:task.prompt,options:task.options || [],answer:task.answer}];
  let answers=[entry.answer];
  if(questions.length>1){try{const values=JSON.parse(entry.answer);answers=Array.isArray(values) ? values : [entry.answer];}catch{answers=[entry.answer];}}
  const results=questionResults(task,entry.answer,entry.feedback,entry.skippedQuestions);
  const legacy=questions.length>1 && !results;
  return `${legacy ? '<p class="field-help">原记录只有整组批改，未推算各小题对错。</p>' : ''}${questions.map((question,i)=>{
    const result=results?.[i] || (questions.length===1 ? entry.feedback : null);
    return `<section class="round-subquestion"><h3>${questions.length>1 ? `${i+1}. ` : ''}${esc(question.prompt)}</h3>${result ? `<span class="round-result ${result.correct ? 'right' : 'wrong'}">${entry.skippedQuestions?.includes(i) ? '未作答' : result.correct ? '答对' : '再巩固'}</span>` : ''}<p class="chat-text">你的回答：<span lang="en">${esc(answers[i] || (entry.skippedQuestions?.includes(i) ? '（已标记不会）' : '（未填写）'))}</span></p><p class="chat-text">${question.options?.length ? '参考答案' : '参考表达'}：<span lang="en">${esc(question.answer || '')}</span></p>${results && result?.explanation ? `<p class="chat-text">${esc(result.explanation)}</p>` : ''}${result?.suggestion ? `<p class="chat-text"><strong>根据你的原句调整</strong><br><span lang="en">${esc(result.suggestion)}</span></p>` : ''}</section>`;
  }).join('')}${renderRevisionHistory(entry,esc)}`;
}

export function renderRevisionHistory(entry,esc) {
  const revisions=entry.revisions || [];
  if(!revisions.length)return '';
  const describe=feedback=>`${feedback.correct ? '回答正确' : '需要巩固'}：${esc(feedback.explanation || '')}${feedback.suggestion ? `<p lang="en">${esc(feedback.suggestion)}</p>`:''}${(feedback.questions || []).map((item,i)=>`<p>${i+1}. ${entry.skippedQuestions?.includes(i) ? '未作答':item.correct ? '答对':'再巩固'} · ${esc(item.explanation || '')}${item.suggestion ? `<br><span lang="en">${esc(item.suggestion)}</span>`:''}</p>`).join('')}`;
  return `<details class="revision-history"><summary>查看批改复核记录（${revisions.length}/3）</summary>${revisions.map((revision,i)=>`<section><h4>第 ${i+1} 次复核 · ${esc(new Date(revision.at).toLocaleString('zh-CN'))}</h4><div><strong>复核前</strong><div>${describe(revision.previousFeedback)}</div></div><div><strong>复核后</strong><div>${describe(revisions[i+1]?.previousFeedback || entry.feedback)}</div></div></section>`).join('')}</details>`;
}
