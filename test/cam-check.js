// Live-camera check with a hidden window: opens the named camera, starts the SDK,
// and reports status, validation hint, readings and errors for a few seconds.
// Usage: NODE_PATH=<global node_modules> node test/cam-check.js [camera-name] [seconds]
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const cam = process.argv[2] || 'EMEET';
  const secs = Number(process.argv[3] || 45);
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules', 'electron')),
    args: [root, `--camera=${cam}`].concat(process.env.NO_SCRIPT ? [] : [`--script=${path.join(root, "demo", "script.txt")}`]),
    env: { ...process.env, MA_HIDDEN: '1' },
  });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.waitForSelector('#script');
  const lines = (await page.inputValue('#script')).split('\n').length;
  console.log('script lines', lines);
  await page.check('#consent');
  await page.click('#btn-begin');
  const seen = { status: new Set(), hint: new Set() };
  let pulse = '–', breath = '–', err = '';
  for (let i = 0; i < secs; i++) {
    await page.waitForTimeout(1000);
    seen.status.add(await page.textContent('#status'));
    seen.hint.add(await page.textContent('#hint'));
    pulse = await page.textContent('#live-pulse');
    breath = await page.textContent('#live-breath');
    err = (await page.isVisible('#error')) ? await page.textContent('#error') : '';
    if (err) break;
  }
  await page.screenshot({ path: path.join(out, 'cam-check.png') });
  const track = await page.evaluate(() => {
    const s = document.getElementById('preview').srcObject;
    const t = s && s.getVideoTracks()[0];
    return t ? { label: t.label, ...t.getSettings() } : null;
  });
  console.log(JSON.stringify({ track: track && { label: track.label, width: track.width, height: track.height, fps: track.frameRate },
    status: [...seen.status], hint: [...seen.hint], pulse, breath, err }, null, 1));
  await app.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
