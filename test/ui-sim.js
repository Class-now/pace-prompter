// Automated UI walk-through with simulated numbers and a hidden window.
// Usage: NODE_PATH=<global node_modules> node test/ui-sim.js   (needs playwright)
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules', 'electron')),
    args: [root, '--simulate'],
    env: { ...process.env, MA_HIDDEN: '1' },
  });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.waitForSelector('#script');
  await page.screenshot({ path: path.join(out, 'sim-1-setup.png') });
  await page.check('#consent');
  await page.click('#btn-begin');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'sim-2-calibrate.png') });
  await page.click('#btn-skip');
  await page.waitForSelector('#view-rehearse:not([hidden])');
  let gated = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(2200);
    if (await page.isVisible('#gate')) {
      gated++;
      if (gated === 1) await page.screenshot({ path: path.join(out, 'sim-3-gate.png') });
      await page.waitForSelector('#gate', { state: 'hidden', timeout: 12000 });
    }
    if (i === 1) await page.screenshot({ path: path.join(out, 'sim-3-rehearse.png') });
    if (await page.isVisible('#view-review')) break;
    await page.keyboard.press('Space');
  }
  await page.waitForSelector('#view-review:not([hidden])', { timeout: 15000 });
  await page.screenshot({ path: path.join(out, 'sim-4-review.png') });
  const rows = await page.locator('.rline').count();
  const spots = await page.locator('#review-spots li').allInnerTexts();
  console.log(JSON.stringify({ rows, gated, spots }, null, 1));
  await app.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
