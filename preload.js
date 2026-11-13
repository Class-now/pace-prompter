'use strict';
// SmartSpectra's bridge (exposes window.__smartspectraBridge), plus our small config object.
require('@smartspectra/node-sdk/preload');
const { contextBridge } = require('electron');
const { pathToFileURL } = require('url');

function pageOptions() {
  const hit = process.argv.find((a) => a.startsWith('--ma-options='));
  try {
    const o = hit ? JSON.parse(Buffer.from(hit.slice('--ma-options='.length), 'base64').toString('utf8')) : {};
    return { camera: String(o.camera || ''), script: String(o.script || ''), blurPreview: !!o.blurPreview };
  } catch { return { camera: '', script: '', blurPreview: false }; }
}

contextBridge.exposeInMainWorld('maConfig', {
  apiKey: process.env.SMARTSPECTRA_API_KEY || '',
  testVideoUrl: process.env.MA_TEST_VIDEO ? pathToFileURL(process.env.MA_TEST_VIDEO).href : '',
  simulate: process.env.MA_SIMULATE === '1',
  ...pageOptions(),
});
