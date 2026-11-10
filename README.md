# Ma (間) — a rehearsal prompter that waits for you to breathe

Ma is a small desktop teleprompter for practising a talk, a pitch or an interview answer.
It watches your pulse and breathing through the webcam with the
[Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra) and does two things with them:

1. **While you rehearse** — when your pulse or breathing climbs clearly above *your own* calm reference
   (taken 30 seconds earlier), Ma holds the next line and asks for one slow breath.
   It reads the chest trace and releases the line when it sees the breath (or after 9 seconds).
2. **Afterwards** — it shows your script again, line by line, with a heat bar for how far your pulse ran
   above your reference on each line, and a short list of "plan a pause here" spots.

"Ma" (間) is the Japanese word for the pause that gives rhythm to speech.

Ma is a pacing aid for rehearsal. It is not a medical device and does not diagnose, treat or
assess any condition. Every number is compared only with the same person's reading from a minute before.

## How it uses the signals

| SmartSpectra signal | What Ma does with it |
|---|---|
| `cardio.pulseRate` | calm reference during calibration; live readout; breath-pause trigger (+10 bpm over your reference); per-line heat in the review |
| `breathing.rate` | calm reference; breath-pause trigger (+5 breaths/min over your reference) |
| `breathing.upperTrace` | drawn as the live breath line; detects the one full breath that releases a pause |
| `face.talking` | shows whether you are speaking; share of each line spent talking |
| `face.blinking` | blinks per minute per line in the review |

## Run it

Requirements: Node.js 20+, a webcam, and a SmartSpectra API key from <https://physiology.presagetech.com>.

```
git clone https://github.com/Class-now/pace-prompter
cd pace-prompter
npm install
echo SMARTSPECTRA_API_KEY=your_key_here > .env
npm start
```

Paste a script, tick the consent box, sit still for the 30-second calibration, then read each line aloud
and press **Space** for the next one. **Esc** ends the run and opens the review.

Good signal needs a steady, well-lit face that fills a fair part of the frame.

### Other inputs (for development)

- `npm start -- --test-video=path/to/face.mp4` feeds a recorded face video through the same SDK path
  (the window is badged **TEST VIDEO**). Useful for working without sitting in front of the camera.
- `npm start -- --simulate` uses made-up numbers and no SDK at all (badged **SIMULATED**), for UI work only.
- `npm test` runs the unit tests for the pacing logic in `src/core.js`.

## Consent and data handling

- **Opt-in every time.** Nothing starts until you tick the consent box on the first screen, which says
  what is measured and why. The camera light is on only between **Start** and the review screen.
- **Camera only.** Ma never requests the microphone; the app's permission handler refuses anything
  other than video for its own local page.
- **What leaves the machine.** The SmartSpectra SDK needs to reach Presage's service with your API key to
  produce measurements. Ma turns the SDK's optional usage telemetry off (`enableTelemetry: false`).
  Ma itself has no server and sends nothing anywhere.
- **What is stored.** Nothing. Video frames are never written to disk. The numbers for the current run
  live in memory and are gone when you close the window or start again. The only way a result leaves
  the app is the **Copy report** button, which puts a Markdown summary on your clipboard.
- **Who is measured.** Only the person who started the session and is sitting in front of it.
  Ma is built for self-rehearsal; do not point it at someone else without their agreement.
- **No health claims.** Readings are shown as rehearsal pacing notes relative to your own resting
  reference, never as a judgement about health or emotion.

## Layout

```
main.js          Electron main process, SmartSpectra IPC bridge, camera-only permission
preload.js       exposes the SDK bridge and run configuration to the page
index.html       the four screens: setup, calibrate, rehearse, review
src/renderer.js  UI flow and SDK wiring
src/core.js      pacing logic with no DOM or SDK dependency (unit-tested)
test/            unit tests and an automated UI walk-through using simulated signals
```

## Licence

MIT. The SmartSpectra SDK is Presage's and is used under its own terms.
