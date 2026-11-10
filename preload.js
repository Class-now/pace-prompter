'use strict';
// SmartSpectra's bridge (exposes window.__smartspectraBridge), plus our small config object.
require('@smartspectra/node-sdk/preload');
const { contextBridge } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('maConfig', {
  apiKey: process.env.SMARTSPECTRA_API_KEY || '',
  testVideoUrl: process.env.MA_TEST_VIDEO ? pathToFileURL(process.env.MA_TEST_VIDEO).href : '',
  simulate: process.env.MA_SIMULATE === '1',
});
