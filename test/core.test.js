'use strict';
const test = require('node:test');
const assert = require('node:assert');
const c = require('../src/core.js');

test('splitScript splits sentences and keeps closing quotes', () => {
  const s = c.splitScript('Hello there. "Is it?" I asked!\n\nNew para without stop');
  assert.deepStrictEqual(s, ['Hello there.', '"Is it?"', 'I asked!', 'New para without stop']);
});

test('splitScript handles Japanese punctuation', () => {
  assert.deepStrictEqual(c.splitScript('こんにちは。元気ですか？はい！'), ['こんにちは。', '元気ですか？', 'はい！']);
});

test('baseline uses the median', () => {
  const b = c.baselineFrom({ pulse: [60, 62, 120, 61], breathing: [14, 15, 16] });
  assert.strictEqual(b.pulse, 61.5);
  assert.strictEqual(b.breathing, 15);
});

test('shouldGate compares only with own baseline', () => {
  const base = { pulse: 65, breathing: 14 };
  assert.strictEqual(c.shouldGate(base, { pulse: 70, breathing: 15 }).gate, false);
  assert.deepStrictEqual(c.shouldGate(base, { pulse: 76, breathing: 15 }).reasons, ['pulse']);
  assert.deepStrictEqual(c.shouldGate(base, { pulse: 66, breathing: 20 }).reasons, ['breathing']);
  assert.strictEqual(c.shouldGate({ pulse: null, breathing: null }, { pulse: 150, breathing: 40 }).gate, false);
});

test('BreathCycleDetector fires once per sine cycle regardless of scale', () => {
  for (const scale of [1, 0.01, 500]) {
    const d = new c.BreathCycleDetector();
    let fired = 0;
    for (let i = 0; i < 300; i++) {
      // 30 samples/s, 4 s per breath -> 2.5 cycles in 10 s
      if (d.feed(scale * Math.sin((2 * Math.PI * i) / 120))) fired++;
    }
    assert.ok(fired >= 2 && fired <= 3, `scale ${scale}: fired ${fired}`);
  }
});

test('BreathCycleDetector ignores a flat trace', () => {
  const d = new c.BreathCycleDetector();
  let fired = 0;
  for (let i = 0; i < 200; i++) if (d.feed(3)) fired++;
  assert.strictEqual(fired, 0);
});

test('countOnsets and onFraction', () => {
  const ev = [{ t: 0, on: false }, { t: 1000, on: true }, { t: 1200, on: false }, { t: 3000, on: true }, { t: 3500, on: true }];
  assert.strictEqual(c.countOnsets(ev), 2);
  assert.strictEqual(c.onFraction(ev, 0, 4000), (200 + 1000) / 4000);
});

test('summarizeLine, tenseSpots and report', () => {
  const base = { pulse: 60, breathing: 14 };
  const mk = (text, pulse) => c.summarizeLine({
    text, tStart: 0, tEnd: 6000, pulse, breathing: [15, 15],
    blinkEvents: [{ t: 100, on: true }, { t: 200, on: false }, { t: 900, on: true }],
    talkEvents: [{ t: 0, on: true }], gated: false,
  }, base);
  const a = mk('Calm line.', [61, 63]);
  const b = mk('Hard line.', [74, 78]);
  assert.strictEqual(a.pulseDelta, 2);
  assert.strictEqual(b.pulseDelta, 16);
  assert.strictEqual(a.blinksPerMin, 20);
  assert.strictEqual(a.talkingFraction, 1);
  const spots = c.tenseSpots([a, b]);
  assert.strictEqual(spots.length, 1);
  assert.strictEqual(spots[0].index, 1);
  const md = c.reportMarkdown([a, b], base, { date: '2026-11-10' });
  assert.match(md, /Line 2 \(\+16 bpm\): Hard line\./);
  assert.match(md, /not medical information/);
});
