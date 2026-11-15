import test from 'node:test';
import assert from 'node:assert/strict';
import { createListeningPlayer, listeningLeadIn } from '../src/listening-player.js';

function fixture() {
  const states = [], errors = [], queue = [], timers = new Map(), listeners = new Map();
  let count = 0, id = 0;
  const synth = { paused: false, voices: [], cancels: 0,
    getVoices() { return this.voices; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    speak(u) { queue.push(u); }, cancel() { this.cancels++; },
    pause() { this.paused = true; }, resume() { this.paused = false; },
  };
  const player = createListeningPlayer({ synth, Utterance: class { constructor(text) { this.text = text; } },
    onState: s => states.push(s), onStarted: () => count++, onError: e => errors.push(e),
    schedule: fn => { timers.set(++id, fn); return id; }, unschedule: key => timers.delete(key),
  });
  return { player, synth, states, errors, queue, timers, listeners, count: () => count };
}

test('listening keeps a spoken lead-in and intact material together; waits for actual start before counting playback', () => {
  const f = fixture(), text = 'The library opens at ten.';
  f.player.play(text);
  assert.equal(f.queue.length, 1);
  assert.equal(f.queue[0].text, listeningLeadIn + text);
  assert.equal(f.states.at(-1), 'loading'); assert.equal(f.count(), 0);
  f.queue[0].onstart(); f.queue[0].onstart();
  assert.equal(f.states.at(-1), 'playing'); assert.equal(f.count(), 1); assert.equal(f.timers.size, 0);
  f.queue[0].onend(); assert.equal(f.states.at(-1), 'idle');
});

test('late voices are used on the next user click, preferring local English without autoplay', () => {
  const f = fixture();
  f.synth.voices = [{ lang: 'zh-CN', localService: true }, { lang: 'en-US', localService: false }, { lang: 'en-GB', localService: true }];
  f.listeners.get('voiceschanged')(); assert.equal(f.queue.length, 0);
  f.player.play('Hello.', .75);
  assert.equal(f.queue[0].voice, f.synth.voices[2]); assert.equal(f.queue[0].rate, .75);
  f.player.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
});

test('replay after pause clears the old utterance and restarts with the lead-in and full material', () => {
  const f = fixture(); f.player.play('First sentence. Second sentence.');
  const old = f.queue[0], oldStart = old.onstart, oldEnd = old.onend, oldError = old.onerror;
  old.onstart(); f.player.pause(); assert.equal(f.states.at(-1), 'paused');
  f.player.resume(); assert.equal(f.count(), 1); assert.equal(f.synth.paused, false);
  f.player.pause(); f.player.play('First sentence. Second sentence.', 1.25);
  assert.equal(f.synth.paused, false); assert.equal(f.synth.cancels, 1);
  assert.equal(f.queue[1].text, listeningLeadIn + 'First sentence. Second sentence.');
  oldStart(); oldEnd(); oldError({ error: 'interrupted' });
  assert.equal(f.states.at(-1), 'loading'); assert.equal(f.errors.length, 0);
  f.queue[1].onstart(); assert.equal(f.count(), 2);
});

test('cancelled startup cannot start late, and startup timeout is recoverable without counting a listen', () => {
  const f = fixture(); f.player.play('Hello.'); const lateStart = f.queue[0].onstart;
  f.player.stop(); lateStart();
  assert.equal(f.states.at(-1), 'idle'); assert.equal(f.count(), 0); assert.equal(f.timers.size, 0);
  f.player.play('Hello.'); [...f.timers.values()][0]();
  assert.equal(f.states.at(-1), 'idle'); assert.match(f.errors[0], /启动超时/); assert.equal(f.count(), 0);
  f.player.play('Hello.'); f.queue.at(-1).onstart(); assert.equal(f.states.at(-1), 'playing');
});

test('speech errors and unsupported devices exit loading with an actionable error', () => {
  const f = fixture(); f.player.play('Hello.'); f.queue[0].onerror({ error: 'audio-hardware' });
  assert.equal(f.states.at(-1), 'idle'); assert.equal(f.timers.size, 0); assert.match(f.errors[0], /audio-hardware/);
  f.synth.speak = () => { throw new Error('unavailable'); }; f.player.play('Hello.');
  assert.equal(f.states.at(-1), 'idle'); assert.equal(f.timers.size, 0);
  const errors = []; createListeningPlayer({ onError: e => errors.push(e) }).play('Hello.');
  assert.match(errors[0], /不支持/);
});
