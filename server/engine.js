import { AppError, providers, validateConfig, callModel } from './providers.js';
import { goals, modes, prompts, gradingContext, validateTask, validateFeedback, validateReport, validateReply } from './coach.js';
import { validateBackground } from './background.js';
import { sharedProfile, examEvidence, examOutlook } from './profile.js';
import { dashboardData, activityData } from './dashboard.js';


const randomUUID = () => globalThis.crypto.randomUUID();
export function createEngine({ initialState = { version: 1, config: null, profiles: {}, sessions: [] }, save, modelCall = callModel, codex, availableProviders = providers, allowImport = true }) {
  let state = initialState, busy = false;
  const dashboardProfile = profile => profile && { level: profile.level, skills: profile.skills, summary: profile.summary?.slice(0, 140) };
  const active = s => s.sessions.find(x => !x.finishedAt);
  function view(options = {}) {
    if (options.compact) return { configured: state.config?.provider === 'codex' || !!state.config?.apiKey,
      config: state.config ? { provider: state.config.provider, baseURL: state.config.baseURL, model: state.config.model, hasKey: !!state.config.apiKey } : null,
      providers: availableProviders, profile: dashboardProfile(sharedProfile(state)), examOutlook: examOutlook(state),
      ...dashboardData(state, options.timeZone), sessions: state.sessions.filter(s => !s.finishedAt).map(s => publicSession(s)) };
    return { configured: state.config?.provider === 'codex' || !!state.config?.apiKey, config: state.config ? { provider: state.config.provider, baseURL: state.config.baseURL, model: state.config.model, hasKey: !!state.config.apiKey } : null,
      providers: availableProviders, profile: sharedProfile(state), profiles: state.profiles, examOutlook: examOutlook(state), backgrounds: state.backgrounds || [], sessions: state.sessions.map(({ prepared, ...s }) => ({ ...s, nextReady: !!prepared, current: s.current ? publicTask(s.current, !!s.feedback) : null })) };
  }
  function profile() { return { profile: sharedProfile(state), examOutlook: examOutlook(state) }; }
  function publicSession({ prepared, ...s }) { return { ...s, nextReady: !!prepared, current: s.current ? publicTask(s.current, !!s.feedback) : null }; }
  function detail(id) {
    const s = state.sessions.find(s => s.id === id);
    if (!s) throw new AppError('找不到这轮学习记录。', 404);
    return publicSession(s);
  }
  function review(goal, offset = 0) {
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    const items = []; let total = 0;
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const s = state.sessions[i]; if (s.goal !== goal) continue;
      for (let j = s.history.length - 1; j >= 0; j--) if (!s.history[j].feedback.correct) {
        if (total >= offset && items.length < 20) items.push(s.history[j]); total++;
      }
    }
    return { items, total, offset, hasMore: offset + items.length < total };
  }
  function publicTask(task, answered) {
    const { answer, ...rest } = task;
    return answered ? { ...rest, answer } : rest;
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
      profile: sharedProfile(s), review: session.review || null,
      learningBackground: s.backgrounds || [],
      examEvidence: ['四级', '六级'].includes(session.goal) ? examEvidence(s, session.goal) : null,
      recentHistory: recent,
      history: history(session) };
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
    if (route === '/api/settings') {
      if (!availableProviders[input.provider]) throw new AppError('此设备不支持该服务商。');
      s.config = validateConfig(input, s.config || {});
      if (s.config.provider === 'codex' && !(await codex.status()).loggedIn) throw new AppError('请先完成 Codex 授权，再启用。', 409);
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
      if (active(s)) throw new AppError('已有未结束的学习，请先继续或结束当前学习。', 409);
      if (!goals.includes(input.goal) || !modes.includes(input.mode)) throw new AppError('请选择有效学习目标与练习方式。');
      let review = null;
      if (input.reviewId) {
        review = s.sessions.filter(x => x.goal === input.goal).flatMap(x => x.history).find(x => x.id === input.reviewId && !x.feedback.correct);
        if (!review) throw new AppError('找不到这条错题记录。');
      }
      const session = { id: randomUUID(), goal: input.goal, mode: input.mode, placement: !!input.placement, targetCount: input.placement ? 6 : 5,
        startedAt: new Date().toISOString(), history: [], current: null, feedback: null, review };
      await next(s, session);
      s.sessions.push(session);
    } else {
      const session = active(s);
      if (!session || session.id !== input.sessionId) throw new AppError('当前学习已变更，请刷新后重试。', 409);
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
      } else if (route === '/api/session/answer') {
        if (input.taskId !== session.current?.id) throw new AppError('题目已变更，请刷新后重试。', 409);
        if (session.feedback) return; // Retry after a lost HTTP response must not grade or count twice.
        const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
        if (!answer || answer.length > 4000) throw new AppError('请先作答，回答最多 4000 字。');
        if (session.current.options.length && !session.current.options.includes(answer)) throw new AppError('请选择题卡中的一个选项。');
        const telemetry = { activeSeconds: Math.max(0, Math.min(1800, Math.round(Number(input.activeSeconds) || 0))), hintUsed: !!input.hintUsed || !!session.currentHelpUsed, replays: Math.max(0, Math.min(100, Math.round(Number(input.replays) || 0))), transcriptViewed: !!input.transcriptViewed };
        const prepareNext = session.history.length + 1 < session.targetCount;
        const result = await modelCall(s.config, prepareNext ? prompts.gradeAndNext : prompts.grade, gradingContext({ ...context(s, session), discussion: session.discussions?.[session.current.id] || [] }, session.current, answer, telemetry));
        const feedback = validateFeedback(prepareNext ? result.feedback : result, session.current, answer);
        session.feedback = feedback;
        session.history.push({ id: randomUUID(), task: session.current, answer, feedback, ...telemetry, askedAt: session.currentAskedAt || session.startedAt, at: new Date().toISOString(), source: { provider: s.config.provider, model: s.config.model || 'Codex 默认模型' } });
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
          session.current = session.prepared.task;
          session.currentAskedAt = new Date().toISOString();
          session.source = session.prepared.source;
          session.feedback = null;
          session.prepared = null;
          session.nextPreparationError = '';
          session.currentHelpUsed = false;
        } else await next(s, session);
      } else if (route === '/api/session/finish') {
        if (session.history.length) {
          const reportContext = context(s, session);
          // Include the same target-specific sample used by the eligibility check,
          // even when recent cross-goal activity has pushed it out of recentHistory.
          if (reportContext.examEvidence?.ready) {
            reportContext.examHistory = [];
            for (let i = s.sessions.length - 1; i >= 0 && reportContext.examHistory.length < 60; i--) {
              const round = s.sessions[i];
              if (round.goal !== session.goal || round.placement) continue;
              for (let j = round.history.length - 1; j >= 0 && reportContext.examHistory.length < 60; j--) reportContext.examHistory.unshift(round.history[j]);
            }
          }
          const report = validateReport(await modelCall(s.config, prompts.report, reportContext));
          const previous = sharedProfile(s);
          const observed = new Set(s.sessions.flatMap(x => x.history).map(x => x.task.skill));
          const thisRound = new Set(session.history.map(x => x.task.skill));
          report.skills = report.skills.map(x => {
            const saved = previous?.skills.find(skill => skill.name === x.name && skill.level !== '未测评');
            if (!thisRound.has(x.name) && saved) return saved;
            return observed.has(x.name) ? x : { name: x.name, level: '未测评', evidence: '还没有该能力的作答记录。' };
          });
          session.report = report;
          const { examEstimate, ...abilityProfile } = report;
          s.profile = { ...abilityProfile, updatedAt: new Date().toISOString() };
          if (['四级', '六级'].includes(session.goal)) {
            s.examEstimates ||= {};
            s.examEstimates[session.goal] = examEvidence(s, session.goal).ready && report.examEstimate ? { ...report.examEstimate, updatedAt: s.profile.updatedAt } : null;
          }
        }
        session.finishedAt = new Date().toISOString();
        session.current = null;
        session.feedback = null;
        session.prepared = null;
        session.nextPreparationError = '';
      } else throw new AppError('接口不存在。', 404);
    }
  }
  return {
    view, detail, review, profile, activity: offset => activityData(state, offset),
    async execute(route, input, options) {
      if (busy) throw new AppError('正在处理上一项请求，请稍后重试。', 409);
      busy = true;
      try {
        // Finished rounds are immutable. Clone only the active round and containers
        // that mutate, preserving rollback without copying the entire archive.
        const draft = { ...state, sessions: state.sessions.map(s => s.finishedAt ? s : structuredClone(s)),
          ...(state.backgrounds ? { backgrounds: state.backgrounds.slice() } : {}),
          ...(state.examEstimates ? { examEstimates: { ...state.examEstimates } } : {}) };
        await mutate(route, input, draft);
        await save(draft);
        state = draft;
        return view(options);
      } finally { busy = false; }
    },
  };
}
