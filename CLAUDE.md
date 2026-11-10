# pace-prompter（アプリ名 Ma）

Presage SmartSpectra SDK Challenge（DEV、締切 2026-11-23 16:59 JST）の応募作。スピーチ練習用のプロンプターで、カメラから取った本人の脈拍・呼吸・発話・瞬きを使い、落ち着いた 30 秒の基準より上がったら次の行を出す前に一呼吸を待つ。終わると行ごとの脈拍の上がり方を色で見せる。

- 大会の状態・要項・提出記録: `C:\For Claude\contest-pm\contests\1123-presage-smartspectra\`（status.md が正典、要項の調査は research-1110.md）
- 構成: `main.js`（Electron 本体）・`preload.js`・`index.html`・`styles.css`・`src/renderer.js`（画面と SDK）・`src/core.js`（DOM を使わない計算、`npm test` の対象）
- 起動: `npm start`（カメラ）／`npm start -- --test-video=<mp4>`（録画入力、テスト用）／`npm start -- --simulate`（SDK なしの模擬値、UI 確認用。デモには使わない）
- UI の自動確認: `MA_HIDDEN=1` でオフスクリーン描画。`NODE_PATH=<グローバルの node_modules> node test/ui-sim.js` が `out/` に画面を保存する
- API キー: `.env` の `SMARTSPECTRA_API_KEY`（コミットしない）。公式サンプルの写しは `C:\For Claude\pace-prompter-ref`（参照用、リポジトリ外）
