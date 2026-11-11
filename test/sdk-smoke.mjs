// Real-SDK smoke test: decode a recorded face video with ffmpeg and push the
// frames into SmartSpectra (custom input, the same path the app uses), then
// check that pulse and breathing readings appear. The SDK's own file input is
// not available in the Windows runtime ("input is unavailable"), so frames are
// pushed instead. Needs ffmpeg on PATH and SMARTSPECTRA_API_KEY (or .env).
// Usage: node test/sdk-smoke.mjs <face.mp4> [width=640]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SmartSpectraSDK,
  PixelFormat,
  breathingMetrics,
  cardioMetrics,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.SMARTSPECTRA_API_KEY && fs.existsSync(path.join(root, '.env'))) {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const video = process.argv[2];
const W = Number(process.argv[3] || 0) || null;
if (!video) { console.error('usage: node test/sdk-smoke.mjs <face.mp4> [width]'); process.exit(2); }

// probe size and fps
function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      if (code) return reject(new Error('ffprobe failed'));
      const [w, h, r] = out.trim().split(',');
      const [n, d] = r.split('/').map(Number);
      resolve({ w: Number(w), h: Number(h), fps: n / (d || 1) });
    });
  });
}
const info = await probe(video);
const Wd = W || Math.min(640, info.w); const H = Math.round((info.h * Wd) / info.w / 2) * 2;
const fps = Math.min(30, info.fps);
const frameBytes = Wd * H * 3;

const sdk = new SmartSpectraSDK({
  apiKey: process.env.SMARTSPECTRA_API_KEY,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics],
  enableTelemetry: false,
});
const pulse = [];
const breath = [];
const seen = { status: [], validation: {}, metricsEvents: 0 };
sdk.on('processingStatus', (s) => { seen.status.push(s); });
sdk.on('validationStatus', (code, _ts, hint) => { const k = `${code}:${hint}`; seen.validation[k] = (seen.validation[k] || 0) + 1; });
process.on('exit', () => console.log('diag', JSON.stringify(seen)));
sdk.on('metrics', (buf) => {
  seen.metricsEvents++;
  const m = decodeMetrics(buf);
  if (seen.metricsEvents <= 2) console.log('metrics keys', Object.keys(m || {}).join(','), JSON.stringify(m?.cardio ?? {}).slice(0, 200));
  for (const p of m.cardio?.pulseRate ?? []) pulse.push(p);
  for (const b of m.breathing?.rate ?? []) breath.push(b);
});
sdk.on('error', (code, message, retryable) => {
  console.error(`SmartSpectra error ${code}: ${message} (retryable=${retryable})`);
  process.exitCode = 1;
});
sdk.useCustomInput();
sdk.start();

const ff = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `scale=${Wd}:${H},fps=${fps}`,
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
let pending = Buffer.alloc(0);
let n = 0;
let rejected = 0;
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for await (const chunk of ff.stdout) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= frameBytes) {
    const frame = Buffer.from(pending.subarray(0, frameBytes));
    pending = pending.subarray(frameBytes);
    const ts = Math.round((n * 1e6) / fps);
    if (!sdk.sendFrame(frame, Wd, H, Wd * 3, PixelFormat.kRGB, ts)) rejected++;
    n++;
    if (n % 150 === 0) console.log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s frames=${n} rejected=${rejected} pulse=${pulse.length} breath=${breath.length}`);
    // pace at real time so the SDK's rate windows see a normal stream
    const ahead = (n * 1000) / fps - (Date.now() - t0);
    if (ahead > 0) await sleep(ahead);
  }
}
await sleep(3000);
await sdk.destroy();

const last = (a) => a.length ? a[a.length - 1] : null;
const fmt = (x) => x ? `${Number(x.value).toFixed(1)} (conf ${Number(x.confidence ?? 0).toFixed(2)})` : '-';
console.log(`frames sent: ${n} (${Wd}x${H} @ ${fps.toFixed(1)} fps), rejected: ${rejected}`);
console.log(`pulse readings: ${pulse.length}, last ${fmt(last(pulse))}`);
console.log(`breathing readings: ${breath.length}, last ${fmt(last(breath))}`);
if (!pulse.length || !breath.length) { console.error('FAIL: no pulse/breathing readings'); process.exit(1); }
console.log('OK: pulse and breathing readings appeared');
