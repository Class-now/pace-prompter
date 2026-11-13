// Main process for Ma. Hosts one window, wires the SmartSpectra IPC bridge,
// and grants camera-only permission to the bundled page.
'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

// Load SMARTSPECTRA_API_KEY from .env (never committed) unless already set.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Dev flags:
//   --test-video=<path>  feed a recorded face video instead of the camera (testing only)
//   --simulate           no SDK at all; synthetic numbers for UI work (clearly labelled)
//   --camera=<name>      use the first camera whose name contains <name> (default: system camera)
//   --script=<path>      start with this text file in the script box instead of the sample
//   --blur-preview       blur the on-screen camera preview only (for screen recordings);
//                        the SDK still measures the sharp camera frames
//   --record=<file.mkv>  record the window (for the demo video); stops when the window closes
//   --record-mic=<name>  add this microphone (DirectShow name) to the recording
const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
process.env.MA_TEST_VIDEO = arg('test-video') ? path.resolve(String(arg('test-video'))) : '';
process.env.MA_SIMULATE = arg('simulate') ? '1' : '';
// Passed to the page as one encoded switch (renderer processes do not see env vars set here).
const pageOptions = {
  camera: typeof arg('camera') === 'string' ? arg('camera') : '',
  blurPreview: !!arg('blur-preview'),
  script: arg('script') ? fs.readFileSync(path.resolve(String(arg('script'))), 'utf8') : '',
};

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#f6f1e7',
    title: 'Ma',
    show: process.env.MA_HIDDEN !== '1', // hidden window for automated UI checks
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false, // our preload re-exports the SDK preload bridge via require()
      nodeIntegration: false,
      offscreen: process.env.MA_HIDDEN === '1',
      additionalArguments: [`--ma-options=${Buffer.from(JSON.stringify(pageOptions)).toString('base64')}`],
    },
  });
  win.setMenuBarVisibility(false);
  bindSmartSpectraIpc(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.MA_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });

  if (typeof arg('record') === 'string') {
    const { startRecording } = require('./src/record.js');
    const stop = startRecording(win, path.resolve(arg('record')), typeof arg('record-mic') === 'string' ? arg('record-mic') : '');
    let stopping = false;
    win.on('close', (e) => {
      if (stopping) return;
      e.preventDefault(); stopping = true;
      stop().then(() => win.destroy());
    });
  }
}

app.whenReady().then(() => {
  // Camera only, and only for our own local page. No microphone: Ma never listens.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
