'use strict';
// Ma renderer: script -> one calm minute -> line-by-line rehearsal paced by live signals -> review.

const {
  SmartSpectraSDK, ProcessingStatus, ValidationCode,
  breathingMetrics, cardioMetrics, faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const core = require('./core.js');

const cfg = window.maConfig || { apiKey: '', testVideoUrl: '', simulate: false };
const $ = (id) => document.getElementById(id);
const CAL_SECONDS = 30;
const GATE_TIMEOUT_MS = 9000;

const SAMPLE = `Good afternoon. My name is Shotaro, and I study languages in Tokyo.
Two years ago, I could read English novels, but I could not order a coffee.
The words were in my head. They would not come out of my mouth.
So I started rehearsing out loud, alone, every night.
What I learned is simple. Speaking is not only vocabulary. Speaking is breathing.
When I am nervous, I rush. When I rush, I run out of air. When I run out of air, I forget.
The Japanese word "ma" means the pause between things. Today I want to talk about the pause.`;

// ---- live state ------------------------------------------------------------
const live = { pulse: null, breathing: null, talking: false, lastSignalAt: 0 };
const trace = []; // recent chest-trace values for the small plot
const breathDetector = new core.BreathCycleDetector();
let sdk = null;
let phase = 'setup'; // setup | calibrate | rehearse | review
let cal = null;      // { pulse:[], breathing:[], startedAt, timer }
let baseline = { pulse: null, breathing: null };
let lines = [];      // rehearsal records
let idx = -1;
let gateState = null; // { timer }
let summaries = [];
let testVideoEl = null;
let cameraStream = null; // our own stream when --camera picks a device; the SDK leaves host streams to us

const tsNum = (ts) => (ts == null ? 0 : typeof ts === 'number' ? ts : typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts));
const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

// ---- signal intake (the only place SDK output enters the app) ---------------
function onSignals(m) {
  const now = performance.now();
  const cur = phase === 'rehearse' && idx >= 0 ? lines[idx] : null;

  for (const p of m.cardio?.pulseRate || []) {
    if (typeof p.value !== 'number' || p.value <= 0) continue;
    live.pulse = p.value; live.lastSignalAt = now;
    if (cal) cal.pulse.push(p.value);
    if (cur) cur.pulse.push(p.value);
    const dot = $('pulse-dot'); dot.classList.remove('beat'); void dot.offsetWidth; dot.classList.add('beat');
  }
  for (const b of m.breathing?.rate || []) {
    if (typeof b.value !== 'number' || b.value <= 0) continue;
    live.breathing = b.value; live.lastSignalAt = now;
    if (cal) cal.breathing.push(b.value);
    if (cur) cur.breathing.push(b.value);
  }
  for (const t of m.breathing?.upperTrace || []) {
    if (typeof t.value !== 'number') continue;
    trace.push(t.value); if (trace.length > 240) trace.shift();
    const fullBreath = breathDetector.feed(t.value);
    if (fullBreath && gateState) releaseGate('breath');
  }
  for (const t of m.face?.talking || []) {
    live.talking = !!t.detected;
    if (cur) cur.talkEvents.push({ t: now, on: !!t.detected });
  }
  for (const b of m.face?.blinking || []) {
    if (cur) cur.blinkEvents.push({ t: now, on: !!b.detected });
  }
  renderLive();
}

function renderLive() {
  $('live-pulse').textContent = live.pulse == null ? '–' : live.pulse.toFixed(0);
  $('live-breath').textContent = live.breathing == null ? '–' : live.breathing.toFixed(0);
  const chip = $('talk-chip');
  chip.textContent = live.talking ? 'speaking' : 'silent';
  chip.classList.toggle('on', live.talking);
  drawTrace();
  if (phase === 'rehearse') {
    const d = live.pulse != null && baseline.pulse != null ? live.pulse - baseline.pulse : null;
    $('vs-rest').textContent = d == null ? '' : `pulse ${d >= 0 ? '+' : ''}${d.toFixed(0)} vs your calm minute`;
  }
  // breathing ring follows the chest trace
  if (trace.length > 20) {
    const lo = Math.min(...trace), hi = Math.max(...trace);
    const k = hi > lo ? (trace[trace.length - 1] - lo) / (hi - lo) : 0.5;
    const scale = (0.8 + 0.45 * k).toFixed(3);
    $('cal-ring').style.transform = `scale(${scale})`;
    $('gate-ring').style.transform = `scale(${scale})`;
  }
}

function drawTrace() {
  const c = $('breath-trace'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (trace.length < 2) return;
  const lo = Math.min(...trace), hi = Math.max(...trace), span = hi - lo || 1;
  g.strokeStyle = '#3f7d6b'; g.lineWidth = 2; g.beginPath();
  trace.forEach((v, i) => {
    const x = (i / 239) * c.width, y = c.height - 8 - ((v - lo) / span) * (c.height - 16);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
}

// ---- SDK lifecycle -------------------------------------------------------------
function showError(msg) { const e = $('error'); e.hidden = !msg; e.textContent = msg || ''; }

async function startSensing() {
  showError('');
  if (cfg.simulate) return startSimulation();
  if (!cfg.apiKey) throw new Error('No API key. Put SMARTSPECTRA_API_KEY=... in .env (see README).');

  sdk = new SmartSpectraSDK({
    apiKey: cfg.apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
    enableAccumulatedOutput: false,
    enableTelemetry: false,
  });
  const statusNames = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '').toLowerCase()]));
  const validationNames = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]));
  sdk.on('processingStatus', (s) => { $('status').textContent = statusNames[s] || String(s); });
  sdk.on('validationStatus', (code, _ts, hint) => {
    $('hint').textContent = code === ValidationCode.kOk ? '' : (hint || validationNames[code] || '');
  });
  sdk.on('metrics', (buf) => {
    try { onSignals(decodeMetrics(buf)); } catch (e) { console.error('decode failed', e); }
  });
  sdk.on('error', (code, message, retryable) => showError(`SmartSpectra error ${code}: ${message}${retryable ? ' (retryable)' : ''}`));
  sdk.on('streamAvailable', (stream) => { $('preview').srcObject = stream; $('preview').play().catch(() => {}); });

  if (cfg.testVideoUrl) {
    // Testing path: a recorded face video stands in for the camera.
    testVideoEl = document.createElement('video');
    testVideoEl.src = cfg.testVideoUrl; testVideoEl.muted = true; testVideoEl.loop = true; testVideoEl.playsInline = true;
    await testVideoEl.play();
    const stream = testVideoEl.captureStream();
    $('preview').srcObject = stream; $('preview').play().catch(() => {});
    sdk.useMediaStream(stream);
  } else if (cfg.camera) {
    // A named camera (machines with capture cards or virtual cameras listed first).
    const probe = await navigator.mediaDevices.getUserMedia({ video: true });
    probe.getTracks().forEach((t) => t.stop());
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const want = cfg.camera.toLowerCase();
    const cam = cams.find((d) => d.label.toLowerCase().includes(want));
    if (!cam) throw new Error(`No camera named "${cfg.camera}". Found: ${cams.map((d) => d.label).join(', ')}`);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    $('preview').srcObject = cameraStream; $('preview').play().catch(() => {});
    sdk.useMediaStream(cameraStream);
  }
  await sdk.start();
}

async function stopSensing() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  if (sdk) {
    try { await sdk.stop(); } catch (e) { console.error(e); }
    try { sdk.destroy(); } catch { /* already gone */ }
    sdk = null;
  }
  if (testVideoEl) { testVideoEl.pause(); testVideoEl = null; }
  if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }
  $('preview').srcObject = null;
  $('status').textContent = 'idle';
  $('hint').textContent = '';
  live.pulse = live.breathing = null; live.talking = false;
  renderLive();
}

// UI-only simulation (no SDK, no camera). Never used for measurements or the demo.
let simTimer = null;
function startSimulation() {
  let t = 0;
  $('status').textContent = 'simulated';
  simTimer = setInterval(() => {
    t += 0.1;
    const nervous = phase === 'rehearse' ? 6 + 8 * Math.sin(t / 9) : 0;
    const m = { breathing: { upperTrace: [{ value: Math.sin(t * 1.5) }] }, face: {} };
    if (Math.round(t * 10) % 10 === 0) {
      m.cardio = { pulseRate: [{ value: 66 + nervous + Math.sin(t) }] };
      m.breathing.rate = [{ value: 14 + nervous / 3 }];
      m.face.talking = [{ detected: phase === 'rehearse' && Math.sin(t / 2) > -0.3 }];
      m.face.blinking = [{ detected: Math.round(t) % 4 === 0 }];
    }
    onSignals(m);
  }, 100);
}

// ---- flow ------------------------------------------------------------------------
function show(view) {
  phase = view;
  for (const v of ['setup', 'calibrate', 'rehearse', 'review']) $('view-' + v).hidden = v !== view;
}

async function begin() {
  const texts = core.splitScript($('script').value);
  if (!texts.length) return;
  lines = texts.map((text) => ({ text, tStart: 0, tEnd: 0, pulse: [], breathing: [], blinkEvents: [], talkEvents: [], gated: false, gateReasons: [] }));
  idx = -1; summaries = []; trace.length = 0; breathDetector.reset();
  live.pulse = live.breathing = null; live.talking = false;
  $('btn-begin').disabled = true;
  show('calibrate');
  cal = { pulse: [], breathing: [], startedAt: performance.now(), timer: null };
  $('cal-count').textContent = String(CAL_SECONDS);
  $('cal-note').textContent = 'Waiting for the first readings…';
  try {
    await startSensing();
  } catch (e) {
    showError(e.message); cal = null; show('setup'); $('btn-begin').disabled = !$('consent').checked; return;
  }
  cal.timer = setInterval(() => {
    const left = Math.max(0, CAL_SECONDS - Math.floor((performance.now() - cal.startedAt) / 1000));
    $('cal-count').textContent = String(left);
    const got = cal.pulse.length + cal.breathing.length;
    $('cal-note').textContent = got ? `Reading you: pulse ${live.pulse?.toFixed(0) ?? '–'} bpm, ${live.breathing?.toFixed(0) ?? '–'} breaths/min` : 'Waiting for the first readings…';
    // Keep waiting past zero until at least one signal has a baseline.
    if (left === 0 && got > 0) startRehearsal();
  }, 250);
}

function startRehearsal() {
  if (!cal) return;
  clearInterval(cal.timer);
  baseline = core.baselineFrom(cal);
  cal = null;
  show('rehearse');
  advance();
}

function advance() {
  const now = performance.now();
  if (gateState) return; // a breath is being taken
  if (idx >= 0) lines[idx].tEnd = now;
  if (idx + 1 >= lines.length) return finish();

  const next = lines[idx + 1];
  const decision = idx >= 0 && $('opt-gate').checked
    ? core.shouldGate(baseline, live)
    : { gate: false, reasons: [] };
  if (decision.gate) {
    next.gated = true; next.gateReasons = decision.reasons;
    $('gate-why').textContent = decision.reasons.includes('pulse')
      ? `Your pulse is ${(live.pulse - baseline.pulse).toFixed(0)} above your calm minute.`
      : `You are breathing faster than in your calm minute.`;
    $('gate').hidden = false;
    breathDetector.reset();
    gateState = { timer: setTimeout(() => releaseGate('timeout'), GATE_TIMEOUT_MS) };
    return;
  }
  showLine(idx + 1);
}

function releaseGate() {
  if (!gateState) return;
  clearTimeout(gateState.timer); gateState = null;
  $('gate').hidden = true;
  showLine(idx + 1);
}

function showLine(i) {
  idx = i;
  lines[i].tStart = performance.now();
  $('line-prev').textContent = i > 0 ? lines[i - 1].text : '';
  $('line-now').textContent = lines[i].text;
  $('line-next').textContent = i + 1 < lines.length ? lines[i + 1].text : '';
  $('bar').style.width = `${(i / lines.length) * 100}%`;
}

async function finish() {
  if (gateState) { clearTimeout(gateState.timer); gateState = null; $('gate').hidden = true; }
  const now = performance.now();
  if (idx >= 0 && !lines[idx].tEnd) lines[idx].tEnd = now;
  const done = lines.filter((l) => l.tStart && l.tEnd);
  summaries = done.map((l) => core.summarizeLine(l, baseline));
  await stopSensing();
  renderReview();
  show('review');
}

function heatColor(delta) {
  if (delta == null) return '#ddd4c2';
  const k = Math.max(0, Math.min(1, delta / 18));
  // calm green -> warm red
  const r = Math.round(63 + (181 - 63) * k), g = Math.round(125 + (69 - 125) * k), b = Math.round(107 + (44 - 107) * k);
  return `rgb(${r},${g},${b})`;
}

function renderReview() {
  const f = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
  $('review-sub').textContent =
    `Your calm minute: pulse ${f(baseline.pulse)} bpm, ${f(baseline.breathing)} breaths/min. ` +
    `Each line is coloured by how far your pulse ran above that. Nothing here was recorded or saved.`;
  const box = $('review-lines'); box.textContent = '';
  summaries.forEach((s) => {
    const row = document.createElement('div'); row.className = 'rline';
    const heat = document.createElement('div'); heat.className = 'heat'; heat.style.background = heatColor(s.pulseDelta);
    const text = document.createElement('div'); text.className = 'rtext'; text.textContent = s.text;
    const meta = document.createElement('div'); meta.className = 'rmeta';
    const d = s.pulseDelta == null ? '–' : (s.pulseDelta >= 0 ? '+' : '') + s.pulseDelta.toFixed(0);
    meta.textContent = `${f(s.pulse)} bpm (${d}) · ${f(s.breathing)} br/min · ${f(s.blinksPerMin)} blinks/min · ${f(s.seconds, 1)} s`;
    if (s.gated) { const ma = document.createElement('span'); ma.className = 'ma'; ma.textContent = '  間 breath taken'; meta.appendChild(ma); }
    row.append(heat, text, meta); box.appendChild(row);
  });
  const ul = $('review-spots'); ul.textContent = '';
  const spots = core.tenseSpots(summaries);
  if (!spots.length) {
    const li = document.createElement('li'); li.textContent = 'No line ran clearly above your calm pulse. Keep this pace.'; ul.appendChild(li);
  }
  for (const s of spots) {
    const li = document.createElement('li');
    li.textContent = `Before line ${s.index + 1} (+${s.pulseDelta.toFixed(0)} bpm): mark a pause and breathe out first. “${s.text}”`;
    ul.appendChild(li);
  }
}

// ---- wiring ----------------------------------------------------------------------
$('script').value = cfg.script ? cfg.script.trim() : SAMPLE;
if (cfg.blurPreview) $('preview').style.filter = 'blur(18px)';
const badge = $('input-badge');
if (cfg.simulate) { badge.textContent = 'SIMULATED numbers (UI test)'; badge.classList.add('sim'); }
else if (cfg.testVideoUrl) { badge.textContent = 'TEST INPUT: recorded video'; badge.classList.add('test'); }
else badge.textContent = 'live camera';

$('consent').addEventListener('change', () => { $('btn-begin').disabled = !$('consent').checked; });
$('btn-begin').addEventListener('click', begin);
$('btn-skip').addEventListener('click', () => { if (cal && (cal.pulse.length || cal.breathing.length || cfg.simulate)) startRehearsal(); });
$('btn-again').addEventListener('click', () => { show('setup'); $('btn-begin').disabled = !$('consent').checked; });
$('btn-copy').addEventListener('click', async () => {
  const md = core.reportMarkdown(summaries, baseline, {
    date: new Date().toISOString().slice(0, 10),
    input: cfg.simulate ? 'simulated' : cfg.testVideoUrl ? 'recorded test video' : 'live camera',
  });
  await navigator.clipboard.writeText(md);
  $('copied').textContent = 'Copied.';
});
window.addEventListener('keydown', (e) => {
  if (phase !== 'rehearse') return;
  if (e.code === 'Space') { e.preventDefault(); advance(); }
  if (e.code === 'Escape') { e.preventDefault(); finish(); }
});
window.addEventListener('beforeunload', () => { if (sdk) { try { sdk.destroy(); } catch { /* gone */ } } });

// Test hook for automated UI checks (simulation only).
if (cfg.simulate) window.__ma = { advance, finish, startRehearsal, get phase() { return phase; } };
