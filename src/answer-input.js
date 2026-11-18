export function questionAnswers(raw, count) {
  if(count===1)return [typeof raw==='string' ? raw : ''];
  try{const values=JSON.parse(raw);if(Array.isArray(values) && values.length===count && values.every(value=>typeof value==='string'))return values;}catch{}
  return Array(count).fill('');
}
export function updateQuestionAnswer(raw, count, index, value) {
  if(!Number.isInteger(index) || index<0 || index>=count)throw new RangeError('Invalid question index');
  const values=questionAnswers(raw,count);values[index]=value;
  return count===1 ? value : JSON.stringify(values);
}
