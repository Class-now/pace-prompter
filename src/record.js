// Demo recorder (main process): pipes the window's own rendered frames into ffmpeg,
// optionally with a microphone for the narration. Used only with --record; the app
// itself never records. Frames come from Electron, so the result does not depend on
// screen capture (which gives black frames for GPU-drawn windows on Windows).
'use strict';
const { spawn } = require('child_process');

function startRecording(win, outPath, mic) {
  let ff = null;
  let size = null;
  let closed = false;
  const offscreen = win.webContents.isOffscreen();

  const open = (w, h) => {
    size = { w, h };
    const args = ['-hide_banner', '-loglevel', 'error', '-y',
      '-use_wallclock_as_timestamps', '1', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${w}x${h}`, '-i', 'pipe:0'];
    if (mic) args.push('-use_wallclock_as_timestamps', '1', '-f', 'dshow', '-i', `audio=${mic}`);
    args.push('-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30', '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
    if (mic) args.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
    args.push(outPath);
    ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => process.stderr.write(`[record] ${d}`));
    ff.stdin.on('error', () => {});
  };

  const onFrame = (image) => {
    if (closed) return;
    let img = image;
    const s = img.getSize();
    if (!s.width || !s.height) return;
    if (!ff) open(s.width, s.height);
    if (s.width !== size.w || s.height !== size.h) img = img.resize({ width: size.w, height: size.h });
    ff.stdin.write(img.toBitmap());
  };

  if (offscreen) win.webContents.on('paint', (_e, _dirty, image) => onFrame(image));
  else win.webContents.beginFrameSubscription(false, (image) => onFrame(image));
  // A static page paints nothing; nudge a repaint so the video keeps time.
  const tick = setInterval(() => { if (!closed) win.webContents.invalidate(); }, 100);

  return function stop() {
    return new Promise((resolve) => {
      if (closed) return resolve();
      closed = true;
      clearInterval(tick);
      if (!offscreen) { try { win.webContents.endFrameSubscription(); } catch { /* gone */ } }
      if (!ff) return resolve();
      ff.on('close', () => resolve());
      ff.stdin.end();
      setTimeout(() => { try { ff.kill(); } catch { /* gone */ } resolve(); }, 20000);
    });
  };
}

module.exports = { startRecording };
