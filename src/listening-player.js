// Keep the lead-in and material in ONE utterance: a gap between separate clips
// can let a Bluetooth output go back to sleep before the first question word.
export const listeningLeadIn = 'Listening practice. Get ready. Three. Two. One. ';

export function createListeningPlayer({ synth, Utterance, onState = () => {}, onStarted = () => {}, onError = () => {},
  schedule = setTimeout, unschedule = clearTimeout }) {
  let utterance = null, timer = null, state = 'idle', voices = [];
  const updateVoices = () => { voices = synth?.getVoices() || []; };
  updateVoices(); // Ask for voices before the learner presses Play.
  synth?.addEventListener?.('voiceschanged', updateVoices);
  const setState = value => { state = value; onState(value); };
  const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  function stop(notify = true) {
    clearTimer();
    const previous = utterance; utterance = null;
    if (previous) {
      previous.onstart = previous.onend = previous.onerror = previous.onpause = previous.onresume = null;
      synth.cancel();
    }
    state = 'idle'; if (notify) onState(state);
  }
  function play(text, rate = 1) {
    stop(false);
    if (!synth || !Utterance) { onState('idle'); onError('当前设备不支持系统语音播放。'); return; }
    if (!text?.trim()) { onState('idle'); onError('这道题没有可播放的听力材料。'); return; }
    const current = new Utterance(listeningLeadIn + text);
    utterance = current;
    updateVoices();
    const english = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    const voice = english.find(v => v.localService) || english[0];
    if (voice) current.voice = voice;
    current.lang = voice?.lang || 'en-US'; current.rate = rate;
    let started = false;
    current.onstart = () => {
      if (utterance !== current) return;
      clearTimer();
      if (!started) { started = true; onStarted(); }
      setState('playing');
    };
    current.onpause = () => { if (utterance === current) setState('paused'); };
    current.onresume = () => { if (utterance === current) setState('playing'); };
    current.onend = () => { if (utterance !== current) return; clearTimer(); utterance = null; setState('idle'); };
    current.onerror = event => {
      if (utterance !== current) return;
      stop(); onError(`声音未能正常播放（${event.error}）。请重新播放，或检查声音输出设备。`);
    };
    setState('loading');
    timer = schedule(() => {
      if (utterance !== current) return;
      stop(); onError('声音启动超时，请确认耳机已连接，再点播放重试。');
    }, 15000);
    try {
      // cancel() can leave the shared engine paused after an earlier pause.
      if (synth.paused) synth.resume();
      // Stay in the user's click handler for browsers requiring user activation.
      synth.speak(current);
    } catch { stop(); onError('声音启动失败，请重新播放。'); }
  }
  return {
    play, stop,
    pause() { if (utterance && state === 'playing') { synth.pause(); setState('paused'); } },
    resume() { if (utterance && state === 'paused') { synth.resume(); setState('playing'); } },
    dispose() { stop(false); synth?.removeEventListener?.('voiceschanged', updateVoices); },
  };
}
