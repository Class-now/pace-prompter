// Checks the --record path with a hidden window: live camera, demo script, mic,
// a few seconds of calibration, then closes the window and reports the file.
// Usage: NODE_PATH=<global node_modules> node test/record-check.js [seconds]
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const outFile = path.join(root, 'out', 'record-check.mkv');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });
  const secs = Number(process.argv[2] || 12);
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules', 'electron')),
    args: [root, '--camera=EMEET', `--script=${path.join(root, 'demo', 'script.txt')}`, '--blur-preview',
      `--record=${outFile}`, '--record-mic=マイク (EMEET SmartCam C960)'],
    env: { ...process.env, MA_HIDDEN: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#script');
  await page.waitForTimeout(2000);
  await page.check('#consent');
  await page.click('#btn-begin');
  await page.waitForTimeout(secs * 1000);
  const exited = new Promise((r) => app.process().on('exit', r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await Promise.race([exited, new Promise((r) => setTimeout(r, 30000))]);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'compact', outFile]).toString();
  console.log(probe.trim());
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-3', '-i', outFile, '-frames:v', '1', path.join(root, 'out', 'record-check.png')]);
  console.log('frame: out/record-check.png');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
