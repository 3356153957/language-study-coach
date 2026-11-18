// Recover explicitly numbered short-answer tasks from older/model responses.
// This deliberately does not split a paragraph into boxes at every full stop.
export function numberedParts(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/([①②③④])\s*|(?:^|\s)([1-4][.、)）])\s*/gu)];
  if (matches.length < 2 || matches.length > 4) return null;
  const number = marker => '①②③④'.includes(marker) ? '①②③④'.indexOf(marker) + 1 : Number(marker[0]);
  if (matches.some((match, i) => number(match[1] || match[2]) !== i + 1)) return null;
  const parts = matches.map((match, i) => text.slice(match.index + match[0].length, matches[i + 1]?.index ?? text.length).trim());
  const last = parts.at(-1).split(/\r?\n(?=(?:可用词|提示|提交前|请保留|注意|要求|参考|检查|Tips?\b))/iu);
  parts[parts.length - 1] = last.shift().trim();
  if (parts.some(part => !part)) return null;
  return { parts, instruction: [text.slice(0, matches[0].index).trim(), ...last].filter(Boolean).join('\n') };
}

export function openQuestionLayout(task) {
  if (!['text', 'conversation'].includes(task?.kind)) return null;
  const source = task.questions?.length === 1 ? task.questions[0] : task;
  if (task.questions?.length > 1 || /写一篇|写一段|一段连贯|\bone (?:coherent )?paragraph\b|\ban? essay\b/i.test(task.prompt || '')) return null;
  const layout = numberedParts(source.prompt);
  if (!layout) return null;
  const reference = source.answer || task.answer || '';
  const answers = numberedParts(reference)?.parts || reference.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const sentences = reference.match(/[^.!?]+[.!?](?=\s|$)/g)?.map(x => x.trim()) || [];
  const aligned = answers.length === layout.parts.length ? answers : sentences.length === layout.parts.length ? sentences : null;
  return { ...layout, questions: aligned ? layout.parts.map((prompt, i) => ({ prompt, options: [], answer: aligned[i] })) : null };
}

export function repairOpenTask(task) {
  const layout = openQuestionLayout(task);
  return layout?.questions ? { ...task, prompt: layout.instruction || '请分别回答每个问题。', options: [], answer: '', questions: layout.questions } : task;
}
