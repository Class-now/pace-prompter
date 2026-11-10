'use strict';
// Pure logic for Ma (no DOM, no SDK) so it can be unit-tested with node --test.

/** Split a pasted script into rehearsal lines (one sentence or clause group each). */
function splitScript(text) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    const t = para.trim();
    if (!t) continue;
    const parts = t.match(/[^.!?。！？]+[.!?。！？]+["'”’)]*|[^.!?。！？]+$/g) || [t];
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Resting reference from the calibration window. Median resists start-up jitter. */
function baselineFrom(samples) {
  return {
    pulse: median(samples.pulse || []),
    breathing: median(samples.breathing || []),
  };
}

/**
 * Should Ma hold the next line and ask for one slow breath?
 * Only compares the speaker with their own baseline from a minute ago.
 * This is a pacing cue, not a health assessment.
 */
function shouldGate(baseline, now, opts = {}) {
  const pulseRise = opts.pulseRise ?? 10; // bpm above own baseline
  const breathRise = opts.breathRise ?? 5; // breaths/min above own baseline
  const reasons = [];
  if (baseline.pulse != null && now.pulse != null && now.pulse - baseline.pulse >= pulseRise) {
    reasons.push('pulse');
  }
  if (baseline.breathing != null && now.breathing != null &&
      now.breathing - baseline.breathing >= breathRise) {
    reasons.push('breathing');
  }
  return { gate: reasons.length > 0, reasons };
}

/**
 * Detects one full breath (rise then fall) on the chest trace.
 * feed(value) returns true once the trace has gone up by `swing` from a trough
 * and then come back down by `swing` from the following peak.
 * `swing` adapts to the recent range of the trace, so no absolute units are assumed.
 */
class BreathCycleDetector {
  constructor() { this.reset(); }
  reset() {
    this.recent = [];
    this.phase = 'seek-rise';
    this.low = Infinity;
    this.high = -Infinity;
  }
  feed(v) {
    if (typeof v !== 'number' || !isFinite(v)) return false;
    this.recent.push(v);
    if (this.recent.length > 300) this.recent.shift();
    const range = Math.max(...this.recent) - Math.min(...this.recent);
    if (this.recent.length < 10 || range <= 0) return false;
    const swing = range * 0.35;
    if (this.phase === 'seek-rise') {
      this.low = Math.min(this.low, v);
      if (v - this.low >= swing) { this.phase = 'seek-fall'; this.high = v; }
    } else {
      this.high = Math.max(this.high, v);
      if (this.high - v >= swing) { this.phase = 'seek-rise'; this.low = v; return true; }
    }
    return false;
  }
}

/** Count false->true transitions in a list of {t, on} detections. */
function countOnsets(events) {
  let n = 0, prev = false;
  for (const e of events) { if (e.on && !prev) n++; prev = e.on; }
  return n;
}

/** Fraction of the [t0,t1] interval during which the last-known state was "on". */
function onFraction(events, t0, t1) {
  if (t1 <= t0) return null;
  let on = false, last = t0, acc = 0;
  for (const e of events) {
    if (e.t < t0) { on = e.on; continue; }
    if (e.t > t1) break;
    if (on) acc += e.t - last;
    last = e.t; on = e.on;
  }
  if (on) acc += t1 - last;
  return acc / (t1 - t0);
}

/** Per-line summary from the raw samples collected while that line was on screen. */
function summarizeLine(line, baseline) {
  const pulse = mean(line.pulse);
  const breathing = mean(line.breathing);
  const seconds = (line.tEnd - line.tStart) / 1000;
  const blinks = countOnsets(line.blinkEvents);
  return {
    text: line.text,
    seconds,
    pulse,
    pulseDelta: pulse != null && baseline.pulse != null ? pulse - baseline.pulse : null,
    breathing,
    breathingDelta: breathing != null && baseline.breathing != null ? breathing - baseline.breathing : null,
    // A rate over a very short line is noise, so only report it from 3 s up.
    blinksPerMin: seconds >= 3 ? (blinks / seconds) * 60 : null,
    talkingFraction: onFraction(line.talkEvents, line.tStart, line.tEnd),
    gated: !!line.gated,
    gateReasons: line.gateReasons || [],
  };
}

/** The lines where the speaker's pulse ran highest above their own baseline. */
function tenseSpots(summaries, n = 3, minDelta = 5) {
  return summaries
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.pulseDelta != null && s.pulseDelta >= minDelta)
    .sort((a, b) => b.pulseDelta - a.pulseDelta)
    .slice(0, n);
}

const fmt = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
const signed = (v) => (v == null ? '–' : (v >= 0 ? '+' : '') + v.toFixed(0));

function reportMarkdown(summaries, baseline, meta = {}) {
  const rows = summaries.map((s, i) =>
    `| ${i + 1} | ${s.text.replace(/\|/g, '/')} | ${fmt(s.seconds, 1)} | ${fmt(s.pulse)} (${signed(s.pulseDelta)}) | ${fmt(s.breathing)} | ${fmt(s.blinksPerMin)} | ${s.gated ? 'yes' : ''} |`);
  const spots = tenseSpots(summaries).map((s) => `- Line ${s.index + 1} (${signed(s.pulseDelta)} bpm): ${s.text}`);
  return [
    `# Ma rehearsal report`,
    ``,
    `${meta.date || ''} · input: ${meta.input || 'camera'}`,
    ``,
    `Resting reference (your own, from calibration): pulse ${fmt(baseline.pulse)} bpm, breathing ${fmt(baseline.breathing)} /min.`,
    `These are pacing notes for rehearsal, not medical information.`,
    ``,
    `| # | Line | sec | pulse (vs rest) | breaths/min | blinks/min | breath pause |`,
    `|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `## Where to plan a pause`,
    ...(spots.length ? spots : ['- No line ran clearly above your resting pulse.']),
    ``,
  ].join('\n');
}

module.exports = {
  splitScript, mean, median, baselineFrom, shouldGate, BreathCycleDetector,
  countOnsets, onFraction, summarizeLine, tenseSpots, reportMarkdown,
};
