@echo off
rem Opens Ma in front with the EMEET camera, the demo script and recording on.
rem Output: out\demo-raw.mkv (an existing file is renamed to demo-raw-<time>.mkv first).
cd /d "%~dp0.."
if not exist out mkdir out
if exist out\demo-raw.mkv ren out\demo-raw.mkv demo-raw-%RANDOM%.mkv
call npm run build
call node_modules\.bin\electron.cmd . --camera=EMEET --script=demo/script.txt --blur-preview --record=out/demo-raw.mkv "--record-mic=É}ÉCÉN (EMEET SmartCam C960)"
