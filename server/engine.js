import { AppError, providers, validateConfig, validateAPIConnection, callModel } from './providers.js';
import { listModels } from './model-catalog.js';
import { goals, modes, skills, prompts, gradingContext, validateTask, validateFeedback, validateLearnerAnswer, validateReport, validateReply, validateDraftAnswer, validateSkippedQuestions, validateExamEstimate } from './coach.js';
import { validateBackground } from './background.js';
import { sharedProfile, examEvidence, examOutlook, gateProfile } from './profile.js';
import { dashboardData, activityData } from './dashboard.js';
import { exportBackup, planImport } from './backup.js';
import { canonical, recordsFromBackup, recordKey, reconcile, mergeCloudRecords } from './sync-records.js';
import { repairOpenTask } from './question-layout.js';
import { validateLearningPlan } from './learning-plan.js';
import { reviewPlan, reviewOverview } from './review-plan.js';
import { learningProgress } from './learning-progress.js';
import { wordbook, normalizeWord, passageWords, taskInRound, mergeWordMarks, laterStamp, definitionPrompt } from './vocabulary.js';
import { assessmentPrompt, mergeAssessments } from './exam-assessment.js';


const randomUUID = () => globalThis.crypto.randomUUID();
export function createEngine({ initialState = { version: 1, config: null, profiles: {}, sessions: [] }, save, modelCall = callModel, modelFetcher = fetch, codex, availableProviders = providers, allowImport = true }) {
  let state = initialState, busy = false;
  const coachChat = (s = state) => ({ turns: s.coachTurns || [] });
  const dashboardProfile = profile => profile && { level: profile.level, skills: profile.skills, summary: profile.summary, nextFocus: profile.nextFocus, learningPlans: profile.learningPlans, updatedAt: profile.updatedAt, live: profile.live };
  const active = s => s.sessions.find(x => !x.finishedAt);
  function recommendations(s) {
    const result={};
    for (const round of [...s.sessions].filter(round=>round.finishedAt && round.report?.nextFocus).sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt))) result[round.goal]={text:round.report.nextFocus,sourceSessionId:round.id};
    return result;
  }
  function closeRound(session, input) {
    if (session.current && !session.feedback) {
      if (input.draftTaskId && input.draftTaskId !== session.current.id) throw new AppError('当前题目已变更，请重新打开当前练习后切换。', 409);
      session.unfinished = { task: session.current, answer: validateDraftAnswer(session.current, input.draftTaskId ? input.draftAnswer || '' : '') };
    }
    session.finishedAt = new Date().toISOString();
    session.current = null; session.feedback = null; session.prepared = null; session.nextPreparationError = '';
  }
  function view(options = {}) {
    if (options.compact) return { configured: ['codex','chatgpt'].includes(state.config?.provider) || !!state.config?.apiKey,
      config: state.config ? { provider: state.config.provider, baseURL: state.config.baseURL, model: state.config.model, hasKey: !!state.config.apiKey } : null,
      providers: availableProviders, profile: dashboardProfile(sharedProfile(state)), examOutlook: examOutlook(state),
      reviews: reviewOverview(state, options.timeZone), recommendations: recommendations(state),
      wordbook: wordbook(state),
      ...dashboardData(state, options.timeZone), sessions: state.sessions.filter(s => !s.finishedAt).map(s => publicSession(s)) };
    return { configured: ['codex','chatgpt'].includes(state.config?.provider) || !!state.config?.apiKey, config: state.config ? { provider: state.config.provider, baseURL: state.config.baseURL, model: state.config.model, hasKey: !!state.config.apiKey } : null,
      providers: availableProviders, profile: sharedProfile(state), profiles: state.profiles, examOutlook: examOutlook(state), reviews: reviewOverview(state, options.timeZone), recommendations:recommendations(state), wordbook: wordbook(state), backgrounds: state.backgrounds || [], sessions: state.sessions.map(({ prepared, ...s }) => ({ ...s, nextReady: !!prepared, current: s.current ? publicTask(s.current, !!s.feedback) : null })) };
  }
  function profile(options = {}) { return { profile: sharedProfile(state), examOutlook: examOutlook(state), progress: learningProgress(state, sharedProfile(state), options.timeZone), reviews: reviewOverview(state, options.timeZone), recommendations:recommendations(state) }; }
  function publicSession({ prepared, ...s }) { return { ...s, nextReady: !!prepared, current: s.current ? publicTask(s.current, !!s.feedback) : null }; }
  function detail(id) {
    const s = state.sessions.find(s => s.id === id);
    if (!s) throw new AppError('找不到这轮学习记录。', 404);
    return publicSession(s);
  }
  function review(goal, offset = 0, options = {}) {
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    const plans = reviewPlan(state, options.timeZone).filter(plan => plan.goal === goal);
    if (options.filter === 'due') {
      const due = plans.filter(plan => plan.due);
      return { items: due.slice(offset, offset + 20).map(plan => ({ ...plan.source, reviewQuestionIndex: plan.reviewQuestionIndex, reviewStatus: { ...plan, source: undefined } })), total: due.length, offset, hasMore: offset + 20 < due.length, dueCount: due.length, filter: 'due' };
    }
    const items = []; let total = 0;
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const s = state.sessions[i]; if (s.goal !== goal) continue;
      for (let j = s.history.length - 1; j >= 0; j--) if (!s.history[j].feedback.correct) {
        if (total >= offset && items.length < 20) { const plan = plans.find(plan => plan.reviewId === s.history[j].id); items.push({ ...s.history[j], ...(plan ? { reviewStatus: { ...plan, source: undefined } } : {}) }); } total++;
      }
    }
    return { items, total, offset, hasMore: offset + items.length < total, dueCount: plans.filter(plan => plan.due).length, filter: 'all' };
  }
  function publicTask(task, answered) {
    if (!answered) task = repairOpenTask(task);
    const { answer, ...rest } = task;
    if (!answered) delete rest.translation;
    if (Array.isArray(rest.questions)) rest.questions = rest.questions.map(question => {
      if (answered) return question;
      const { answer: hidden, ...publicQuestion } = question;
      return publicQuestion;
    });
    return answered ? { ...rest, answer } : rest;
  }
  function updateLiveProfile(s, entry) {
    const previous = sharedProfile(s), previousSkills = previous?.skills || [];
    const currentSkill = entry.task.skill;
    s.profile = {
      level: previous?.level || '正在了解你的水平',
      ...(previous?.learningPlans ? { learningPlans: previous.learningPlans } : {}),
      summary: `${currentSkill}练习 · ${entry.task.prompt.slice(0, 100)}\n${entry.feedback.explanation.slice(0, 1800)}`,
      nextFocus: entry.feedback.weakness ? `接下来练习${currentSkill}中的“${entry.feedback.weakness}”。` : `继续${currentSkill}练习，尝试新的情境。`,
      skills: skills.map(name => {
        // A live update is still evidence. Keep it when the next answer tests a
        // different skill, otherwise the dashboard appears to forget progress.
        const saved = previousSkills.find(skill => skill.name === name);
        if (name !== currentSkill) return saved || { name, level: '未测评', evidence: '还没有该能力的作答记录。' };
        return { name, level: saved?.level && saved.level !== '未测评' ? saved.level : '练习中', evidence: `最近完成${entry.task.level}难度的${name}题，${entry.feedback.correct ? '本题回答正确。' : `需要巩固：${entry.feedback.weakness || '本题知识点'}。`}`, live: true };
      }),
      updatedAt: new Date().toISOString(),
      live: true,
    };
  }
  function reviewContext(s, session) {
    const review=session.review || (session.reviewId ? s.sessions.flatMap(round=>round.history).find(entry=>entry.id===session.reviewId) : null) || null;
    if(!review || session.reviewQuestionIndex === undefined)return review;
    const index=session.reviewQuestionIndex;
    return {...review,reviewQuestionIndex:index,targetQuestion:review.task.questions[index],targetFeedback:review.feedback.questions?.[index],targetAnswer:JSON.parse(review.answer)[index]};
  }
  function context(s, session) {
    const history = round => round.history.map(entry => round.discussions?.[entry.task.id]?.length ? { ...entry, discussion: round.discussions[entry.task.id] } : entry);
    const recent = []; let remaining = 30;
    for (let i = s.sessions.length - 1; i >= 0 && remaining; i--) {
      const round = s.sessions[i]; if (round.id === session.id) continue;
      const entries = history({ ...round, history: round.history.slice(-remaining) }).map(entry => ({ ...entry, goal: round.goal }));
      recent.unshift(...entries); remaining -= entries.length;
    }
    return { goal: session.goal, mode: session.mode, placement: session.placement, targetCount: session.targetCount,
      profile: sharedProfile(s), review: reviewContext(s,session),
      learningPlan: sharedProfile(s)?.learningPlans?.[session.goal] || null,
      recommendedFocus: session.focus || null,
      learningBackground: s.backgrounds || [],
      examEvidence: ['四级', '六级'].includes(session.goal) ? examEvidence(s, session.goal) : null,
      recentHistory: recent,
      history: history(session) };
  }
  function reportEvidence(s, session) {
    const cutoff=Date.parse(session.finishedAt);
    const sessions=s.sessions.filter(round=>Date.parse(round.startedAt)<=cutoff).map(round=>({...round,
      history:round.history.filter(entry=>Date.parse(entry.at)<=cutoff),
      report:Date.parse(round.finishedAt)<=cutoff ? round.report : null,
      finishedAt:Date.parse(round.finishedAt)<=cutoff ? round.finishedAt : null}));
    const archived=sessions.filter(round=>round.report).sort((a,b)=>Date.parse(b.report.updatedAt || b.finishedAt)-Date.parse(a.report.updatedAt || a.finishedAt))[0]?.report;
    const profile=s.profile && Date.parse(s.profile.updatedAt)<=cutoff ? s.profile : archived || null;
    return {...s,sessions,profile,profiles:Object.fromEntries(Object.entries(s.profiles || {}).filter(([,value])=>Date.parse(value.updatedAt)<=cutoff)),
      backgrounds:(s.backgrounds || []).filter(value=>Date.parse(value.importedAt)<=cutoff)};
  }
  async function writeReport(s, session, recovering=false) {
    const evidence=recovering ? reportEvidence(s,session) : s;
    const reportContext=context(evidence,session);
    if(recovering){reportContext.reportAsOf=session.finishedAt;reportContext.reportRecovery=true;}
    const report=validateReport(await modelCall(s.config,prompts.report,reportContext));
    const previous=sharedProfile(evidence),currentProfile=sharedProfile(s);
    if(currentProfile?.learningPlans)report.learningPlans=currentProfile.learningPlans;
    else delete report.learningPlans;
    const observed=new Set(evidence.sessions.flatMap(round=>round.history).map(entry=>entry.task.skill));
    const thisRound=new Set(session.history.map(entry=>entry.task.skill));
    report.skills=report.skills.map(item=>{
      const saved=previous?.skills.find(skill=>skill.name===item.name && skill.level!=='未测评');
      if(!thisRound.has(item.name) && saved)return saved;
      return observed.has(item.name) ? item : {name:item.name,level:'未测评',evidence:'还没有该能力的作答记录。'};
    });
    report.examEstimate=null; // Predictions are only requested explicitly by the learner.
    const gatedReport = gateProfile(evidence, report);
    const now=new Date().toISOString();
    session.report={...gatedReport,updatedAt:recovering ? session.finishedAt : now,...(recovering ? {generatedAt:now} : {})};
    delete session.reportError;
    const laterEvidence=s.sessions.some(round=>round.history.some(entry=>Date.parse(entry.at)>Date.parse(session.finishedAt)));
    if(!recovering || !laterEvidence && (!currentProfile || Date.parse(currentProfile.updatedAt || 0)<=Date.parse(session.finishedAt))){
      const {examEstimate,...abilityProfile}=gatedReport;
      s.profile={...abilityProfile,updatedAt:session.report.updatedAt};
    }
  }
  async function next(s, session) {
    const result = await modelCall(s.config, prompts.next, context(s, session));
    session.current = validateTask(result, session);
    session.currentAskedAt = new Date().toISOString();
    session.feedback = null;
    session.prepared = null;
    session.nextPreparationError = '';
    session.currentHelpUsed = false;
    session.source = { provider: s.config.provider, model: s.config.model || 'Codex 默认模型' };
  }
  async function mutate(route, input, s) {
    if (route === '/api/vocabulary/mark') {
      const round = s.sessions.find(round => round.id === input.sessionId);
      const task = round && taskInRound(round, input.taskId), word = normalizeWord(input.word);
      if (!task || word.length > 80 || !passageWords(task.passage).some(w => normalizeWord(w) === word)) throw new AppError('请从阅读文章中选择单词。');
      if (!['learning','removed'].includes(input.status)) throw new AppError('请选择有效的单词状态。');
      if ((round.wordMarks?.length || 0) >= 8000 && !round.wordMarks.some(m=>m.taskId===task.id && m.word===word)) throw new AppError('本轮单词标记已达到上限。');
      const existing = (round.wordMarks || []).find(m => m.taskId === task.id && m.word === word);
      round.wordMarks = mergeWordMarks(round.wordMarks, [{ taskId: task.id, word, status: input.status, updatedAt: laterStamp(existing?.updatedAt) }]);
    } else if (route === '/api/vocabulary/define') {
      if (!Array.isArray(input.words) || !input.words.length || input.words.length>8 || input.words.some(word=>typeof word!=='string') || new Set(input.words).size!==input.words.length) throw new AppError('请选择 1 至 8 个生词获取中文释义。');
      const book=wordbook(s),items=input.words.map(word=>book.find(item=>item.word===word));
      if(items.some(item=>!item))throw new AppError('单词本已变更，请重新打开后重试。',409);
      const missing=items.filter(item=>!item.meaning);
      if(!missing.length)return;
      let result;
      try{result=await modelCall(s.config,definitionPrompt,{words:missing.map(item=>({word:item.word,context:item.sources[0].context}))});}
      catch(error){throw error instanceof AppError ? error : new AppError('中文释义暂未获取成功，生词已保存，可以重试。',502);}
      const definitions=result?.definitions;
      if(!Array.isArray(definitions) || definitions.length!==missing.length || new Set(definitions.map(d=>d?.word)).size!==missing.length)throw new AppError('AI 未返回完整中文释义，生词已保留，请重试。',502);
      for(const item of missing){
        const definition=definitions.find(d=>d?.word===item.word);
        if(!definition || typeof definition.meaning!=='string' || !/[\u4e00-\u9fff]/.test(definition.meaning) || definition.meaning.length>300 || typeof definition.translation!=='string' || !/[\u4e00-\u9fff]/.test(definition.translation) || definition.translation.length>1500)throw new AppError('AI 未返回有效中文释义，生词已保留，请重试。',502);
        const source=item.sources[0],round=s.sessions.find(r=>r.id===source.sessionId);
        round.wordMarks=round.wordMarks.map(mark=>mark.word===item.word && mark.taskId===source.taskId ? {...mark,meaning:definition.meaning.trim(),translation:definition.translation.trim(),definedAt:new Date().toISOString()} : mark);
      }
    } else if (route === '/api/vocabulary/status') {
      if (!['learning','mastered','removed'].includes(input.status)) throw new AppError('请选择有效的单词状态。');
      const word = normalizeWord(input.word), updatedAt = laterStamp(...s.sessions.flatMap(round => (round.wordMarks || []).filter(mark => mark.word === word).map(mark => mark.updatedAt)));
      if (!wordbook(s).some(item=>item.word===word)) throw new AppError('这个单词已移出单词本，请刷新后重试。',409);
      for (const round of s.sessions) round.wordMarks = (round.wordMarks || []).map(mark => mark.word===word && mark.status!=='removed' ? {...mark,status:input.status,updatedAt} : mark);
    } else if (route === '/api/exam/assess') {
      if (!['四级','六级'].includes(input.goal)) throw new AppError('请选择四级或六级。');
      if (typeof input.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(input.requestId)) throw new AppError('评估标识无效，请重试。');
      const existing=s.sessions.flatMap(round=>round.examAssessments || []).find(item=>item.id===input.requestId);
      if(existing) return;
      const evidence=examEvidence(s,input.goal);
      if (!evidence.count) throw new AppError('请先完成至少一道该目标下的无提示练习，再点击 AI 评估。');
      const rounds=s.sessions.filter(round=>round.goal===input.goal && !round.placement && round.history.length);
      const history=rounds.flatMap(round=>round.history).sort((a,b)=>a.at.localeCompare(b.at)).slice(-60);
      let result;
      try{result=await modelCall(s.config,assessmentPrompt,{goal:input.goal,evidence,history,profile:sharedProfile(s),previous:examOutlook(s)[input.goal].estimate});}
      catch(error){throw error instanceof AppError ? error : new AppError('AI 评估暂时失败，请检查模型连接后重试。上次结果已保留。',502);}
      const estimate=validateExamEstimate(result);
      if (!estimate || !Object.hasOwn(estimate,'probability')) throw new AppError(typeof result?.reason==='string' && result.reason.trim() ? `AI 暂无法估计：${result.reason.slice(0,1500)}。上次结果已保留。` : 'AI 未返回有效通过率，上次结果已保留，请重试。',502);
      const round=rounds.at(-1);
      round.examAssessments=mergeAssessments(round.examAssessments,[{...estimate,id:input.requestId,updatedAt:new Date().toISOString()}]);
    } else if (route === '/api/data/import') {
      const result=planImport(s,input.backup);
      Object.assign(s,result.state);
      return result.summary;
    } else if (route === '/api/profile/refresh') {
      const latest = [...s.sessions].filter(round => round.history.length).sort((a,b) => b.history.at(-1).at.localeCompare(a.history.at(-1).at))[0];
      if (!latest) throw new AppError('完成一道练习后，就可以生成学习小结。', 409);
      const previous = sharedProfile(s);
      const report = validateReport(await modelCall(s.config, prompts.report, { ...context(s, latest), overview: true }));
      const observed = new Set(s.sessions.flatMap(round => round.history).map(entry => entry.task.skill));
      s.profile = gateProfile(s, {
        level: report.level, summary: report.summary, nextFocus: report.nextFocus,
        skills: report.skills.map(item => observed.has(item.name) ? item : previous?.skills?.find(skill => skill.name === item.name) || { name: item.name, level: '未测评', evidence: '完成这项练习后查看进展。' }),
        ...(previous?.learningPlans ? { learningPlans: previous.learningPlans } : {}),
        updatedAt: new Date().toISOString(),
      });
    } else if (route === '/api/session/report') {
      const session=s.sessions.find(round=>round.id===input.sessionId);
      if(!session?.finishedAt || !session.history.length)throw new AppError('请先完成至少一道题并结束本轮，再生成小结。',409);
      if(!session.report || input.regenerate === true){
        try{await writeReport(s,session,true);}
        catch(error){throw error instanceof AppError ? error : new AppError('小结暂未生成，请检查模型连接后重试；已保存的回答没有改变。',502);}
      }
    } else if (route === '/api/learning-plan') {
      if (!goals.includes(input.goal)) throw new AppError('请选择有效学习目标。');
      const plan = validateLearningPlan(input);
      const previous = sharedProfile(s) || { level: '正在了解你的水平', summary: '开始练习后逐步积累能力证据。', nextFocus: '从适合你的任务开始。', skills: skills.map(name => ({ name, level: '未测评', evidence: '还没有该能力的作答记录。' })) };
      s.profile = { ...previous, learningPlans: { ...(previous.learningPlans || {}), [input.goal]: plan }, updatedAt: plan.updatedAt };
    } else if (route === '/api/settings') {
      if (!availableProviders[input.provider]) throw new AppError('此设备不支持该服务商。');
      s.config = validateConfig(input, s.config || {});
      if (s.config.provider === 'codex' && !(await codex.status()).loggedIn) throw new AppError('请先完成 Codex 授权，再启用。', 409);
    } else if (route === '/api/coach/chat') {
      const message = typeof input.message === 'string' ? input.message.trim() : '';
      if (!message || message.length > 2000) throw new AppError('请输入想和教练聊的内容，最多 2000 字。');
      if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new AppError('消息标识无效，请重试。');
      const goal = goals.includes(input.goal) ? input.goal : null;
      const { turns } = coachChat(s);
      const previous = turns.find(turn => turn.id === input.requestId);
      if (previous) {
        if (previous.message !== message || previous.goal !== goal) throw new AppError('这条消息已变更，请重新发送。', 409);
        return;
      }
      if (!s.config) throw new AppError('请先在设置中连接学习模型。', 409);
      const round = active(s), task = round?.current;
      const currentPractice = task && round.goal === goal ? { mode: round.mode, skill: task.skill, level: task.level, examPart: task.examPart } : null;
      const reply = validateReply(await modelCall(s.config, prompts.conversation, {
        goal, profile: dashboardProfile(sharedProfile(s)), currentPractice,
        conversation: turns.slice(-8).map(({ goal, message, reply }) => ({ goal, message, reply })), message,
      }));
      s.coachTurns = [...turns, { id: input.requestId, goal, message, reply, at: new Date().toISOString() }].slice(-30);
    } else if (route === '/api/settings/test') {
      const result = await modelCall(s.config, '只返回 JSON 对象 {"ok":true}。', { action: 'connection-test' });
      if (result.ok !== true) throw new AppError('接口可连接，但模型没有遵循 JSON 输出要求。', 502);
    } else if (route === '/api/background/import') {
      if (!allowImport) throw new AppError('此版本不支持导入学习背景。', 404);
      const background = validateBackground(input);
      s.backgrounds ||= [];
      const index = s.backgrounds.findIndex(x => x.goal === background.goal && x.source.threadId === background.source.threadId);
      const saved = { ...background, importedAt: new Date().toISOString() };
      if (index < 0) s.backgrounds.push(saved);
      else s.backgrounds[index] = saved;
    } else if (route === '/api/session/start') {
      const previousRound = active(s);
      if (input.replaceSessionId && previousRound?.id !== input.replaceSessionId) throw new AppError('当前练习已变更，请刷新后重试。', 409);
      if (previousRound && input.replaceSessionId !== previousRound.id) throw new AppError('已有未结束的学习，请先继续或结束当前学习。', 409);
      if (!goals.includes(input.goal) || !modes.includes(input.mode)) throw new AppError('请选择有效学习目标与练习方式。');
      let review = null;
      if (input.reviewId) {
        review = s.sessions.filter(x => x.goal === input.goal).flatMap(x => x.history).find(x => x.id === input.reviewId && !x.feedback.correct);
        if (!review) throw new AppError('找不到这条错题记录。');
        if (input.reviewQuestionIndex !== undefined) {
          const plan = reviewPlan(s).find(plan => plan.reviewId === review.id && plan.reviewQuestionIndex === input.reviewQuestionIndex);
          if (!plan) throw new AppError('找不到要复习的错题小项，请重新打开复习列表。');
          const index = input.reviewQuestionIndex;
          review = {...review, targetQuestion: review.task.questions[index], targetFeedback: review.feedback.questions?.[index], targetAnswer: JSON.parse(review.answer)[index], reviewQuestionIndex:index};
        }
      }
      let focus = null;
      if (input.recommendationId) {
        const source = s.sessions.find(round => round.id === input.recommendationId && round.finishedAt && round.goal === input.goal);
        if (!source?.report?.nextFocus) throw new AppError('没有找到这轮小结的练习建议。');
        focus = { text: source.report.nextFocus, sourceSessionId: source.id };
      } else if (input.useProfileFocus) {
        focus = recommendations(s)[input.goal] || null;
        if (!focus) throw new AppError('这个学习目标还没有可执行的小结建议，请先完成一轮练习。');
      }
      const session = { id: randomUUID(), goal: input.goal, mode: input.mode, placement: !!input.placement, targetCount: input.placement ? 6 : 5,
        startedAt: new Date().toISOString(), history: [], current: null, feedback: null, review, ...(review ? { reviewId: review.id, ...(input.reviewQuestionIndex !== undefined ? {reviewQuestionIndex:input.reviewQuestionIndex} : {}) } : {}), ...(focus ? { focus } : {}) };
      await next(s, session);
      // Prepare first, then commit both changes together. A failed model request
      // or disk write leaves the previous exercise and draft available.
      if (previousRound) {
        closeRound(previousRound, input);
        if (previousRound.history.length) previousRound.reportError = '已保留本轮作答与未提交草稿；切换练习时未请求 AI 小结。';
      }
      s.sessions.push(session);
    } else {
      const session = active(s);
      if (!session || session.id !== input.sessionId) throw new AppError('当前学习已变更，请刷新后重试。', 409);
      if (session.current && !session.feedback) session.current = repairOpenTask(session.current);
      if (route === '/api/session/discuss') {
        const entry = session.history.find(x => x.task.id === input.taskId);
        const task = entry?.task || (session.current?.id === input.taskId ? session.current : null);
        if (!task) throw new AppError('找不到要讨论的题目，请刷新后重试。', 409);
        const message = typeof input.message === 'string' ? input.message.trim() : '';
        if (!message || message.length > 2000) throw new AppError('请输入想问教练的内容，最多 2000 字。');
        if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new AppError('消息标识无效，请重试。');
        const discussion = session.discussions?.[task.id] || [];
        const previous = Object.values(session.discussions || {}).flat().find(turn => turn.id === input.requestId);
        if (previous) {
          if (previous.message !== message || !discussion.includes(previous)) throw new AppError('这条消息已变更，请重新发送。', 409);
          return;
        }
        if (discussion.length >= 30) throw new AppError('这道题已经讨论了 30 次，可以继续练下一题。', 409);
        const draftAnswer = typeof input.draftAnswer === 'string' ? input.draftAnswer.trim().slice(0, 4000) : '';
        const answered = !!entry;
        const publicQuestion = publicTask(task, answered && !!task.options.length);
        const reply = validateReply(await modelCall(s.config, prompts.discuss, { goal: session.goal, mode: session.mode,
          profile: sharedProfile(s), learningBackground: s.backgrounds || [],
          task: publicQuestion, answered, learnerAnswer: entry?.answer || draftAnswer,
          feedback: entry?.feedback || null, discussion: discussion.slice(-8), message }));
        session.discussions ||= {};
        session.discussions[task.id] = [...discussion, { id: input.requestId, message, reply, at: new Date().toISOString() }];
        if (!answered) session.currentHelpUsed = true;
      } else if (route === '/api/session/regrade') {
        const entry = session.history.find(x => x.task.id === input.taskId);
        if (!entry) throw new AppError('只能复核本轮已经提交的回答。', 409);
        if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new AppError('复核标识无效，请重试。');
        if (entry.revisions?.some(x => x.id === input.requestId)) return;
        if ((entry.revisions?.length || 0) >= 3) throw new AppError('本题已复核 3 次，可以继续讨论或练习下一题。');
        const feedback = validateFeedback(await modelCall(s.config, prompts.grade, gradingContext({ ...context(s, session), regrade: true,
          discussion: session.discussions?.[entry.task.id] || [], previousFeedback: entry.feedback }, entry.task, entry.answer,
          { hintUsed: entry.hintUsed, transcriptViewed: entry.transcriptViewed, replays: entry.replays, skippedQuestions:entry.skippedQuestions || [] })), entry.task, entry.answer, {skippedQuestions:entry.skippedQuestions || []});
        entry.revisions = [...(entry.revisions || []), { id: input.requestId, at: new Date().toISOString(), previousFeedback: entry.feedback }];
        entry.feedback = feedback;
        const previousProfile = sharedProfile(s);
        const allEntries = s.sessions.flatMap(round => round.history);
        const latest = allEntries.filter(value => value.task.skill === entry.task.skill).sort((a,b) => b.at.localeCompare(a.at))[0];
        updateLiveProfile(s, latest);
        if (previousProfile && allEntries.some(value => value.at > entry.at)) {
          s.profile.summary = previousProfile.summary;
          s.profile.nextFocus = previousProfile.nextFocus;
        }
        if (session.current?.id === entry.task.id) session.feedback = feedback;
        // Re-plan after the revised judgement instead of using a stale task.
        session.prepared = null;
        session.nextPreparationError = '批改已复核，继续时会结合复核结果安排下一题。';
      } else if (route === '/api/session/answer') {
        if (input.taskId !== session.current?.id) throw new AppError('题目已变更，请刷新后重试。', 409);
        if (session.feedback) return; // Retry after a lost HTTP response must not grade or count twice.
        const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
        const skippedQuestions = validateSkippedQuestions(session.current, input.skippedQuestions);
        validateLearnerAnswer(session.current, answer, {skippedQuestions});
        const telemetry = { activeSeconds: Math.max(0, Math.min(1800, Math.round(Number(input.activeSeconds) || 0))), hintUsed: !!input.hintUsed || !!session.currentHelpUsed, replays: Math.max(0, Math.min(100, Math.round(Number(input.replays) || 0))), transcriptViewed: !!input.transcriptViewed, ...(skippedQuestions.length ? {skippedQuestions} : {}) };
        const prepareNext = session.history.length + 1 < session.targetCount;
        const result = await modelCall(s.config, prepareNext ? prompts.gradeAndNext : prompts.grade, gradingContext({ ...context(s, session), discussion: session.discussions?.[session.current.id] || [] }, session.current, answer, telemetry));
        const feedback = validateFeedback(prepareNext ? result.feedback : result, session.current, answer, {skippedQuestions});
        session.feedback = feedback;
        session.history.push({ id: randomUUID(), task: session.current, answer, feedback, ...telemetry, ...(!session.history.length && (session.reviewId || session.review?.id) ? { reviewOf: session.reviewId || session.review.id, ...(session.reviewQuestionIndex !== undefined ? {reviewQuestionIndex:session.reviewQuestionIndex} : {}) } : {}), askedAt: session.currentAskedAt || session.startedAt, at: new Date().toISOString(), source: { provider: s.config.provider, model: s.config.model || 'Codex 默认模型' } });
        updateLiveProfile(s, session.history.at(-1));
        session.prepared = null;
        session.nextPreparationError = '';
        if (prepareNext) {
          try {
            session.prepared = { task: validateTask(result.nextTask, session), source: { ...session.history.at(-1).source } };
          } catch {
            // A bad follow-up must not discard a valid grade or the user's answer.
            session.nextPreparationError = '本次回答已保存，下一题未准备好，点击继续时会重新生成。';
          }
        }
      } else if (route === '/api/session/next') {
        if (input.taskId !== session.current?.id) throw new AppError('题目已更新，请刷新页面。', 409);
        if (!session.feedback) throw new AppError('请先提交当前回答。');
        if (session.history.length >= session.targetCount) throw new AppError('本轮已完成，请生成学习小结。');
        if (session.prepared) {
          session.current = repairOpenTask(session.prepared.task);
          session.currentAskedAt = new Date().toISOString();
          session.source = session.prepared.source;
          session.feedback = null;
          session.prepared = null;
          session.nextPreparationError = '';
          session.currentHelpUsed = false;
        } else await next(s, session);
      } else if (route === '/api/session/finish') {
        if (session.history.length) {
          try { await writeReport(s,session); }
          catch (error) {
            session.report=null;
            session.reportError=error instanceof AppError ? error.message : '学习小结暂时生成失败，可稍后在本轮记录里补生成。';
          }
        }
        closeRound(session, input);
      } else throw new AppError('接口不存在。', 404);
    }
  }
  return {
    view, detail, review, profile, coachChat, activity: offset => activityData(state, offset),
    async models(input) {
      if (!Object.hasOwn(availableProviders, input.provider)) throw new AppError('此设备不支持该服务商。');
      const config = validateAPIConnection(input, state.config || {});
      return listModels(config, modelFetcher);
    },
    backup: () => exportBackup(state), previewImport: input => planImport(state,input).summary,
    async mergeCloud(records) {
      if(busy) throw new AppError('正在保存本次练习，稍后自动重试同步。',409);
      busy=true;
      try {
        const local=new Map(recordsFromBackup(exportBackup(state)).map(r=>[recordKey(r),r]));
        const changes=records.filter(r=>{
          const old=local.get(recordKey(r));
          if(old && !reconcile(old,r)) throw new AppError('练习进度刚刚变化，稍后自动重新合并。',409);
          return !old || canonical(old.payload)!==canonical(r.payload);
        });
        if(!changes.length) return;
        const draft=mergeCloudRecords(state,changes);
        exportBackup(draft); // Validate aggregate limits before committing a cloud page.
        await save(draft);state=draft;
      } finally {busy=false;}
    },
    async execute(route, input, options) {
      if (busy) throw new AppError('正在处理上一项请求，请稍后重试。', 409);
      busy = true;
      try {
        // Clone only the active round or the archive receiving a missing report.
        // A failed disk write must preserve every original record.
        const draft = { ...state, sessions: state.sessions.map(s => !s.finishedAt || route.startsWith('/api/vocabulary/') || route === '/api/exam/assess' || route === '/api/session/report' && s.id === input.sessionId ? structuredClone(s) : s),
          ...(state.backgrounds ? { backgrounds: state.backgrounds.slice() } : {}),
          ...(state.examEstimates ? { examEstimates: { ...state.examEstimates } } : {}) };
        const importSummary=await mutate(route, input, draft);
        await save(draft);
        state = draft;
        if (route === '/api/coach/chat') return coachChat();
        return { ...view(options), ...(importSummary ? { importSummary } : {}) };
      } finally { busy = false; }
    },
  };
}
