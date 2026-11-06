# Oscillo

A test and measurement app for Digilent instruments on macOS: oscilloscope, waveform generator, supplies, logic analyzer, protocol tools, spectrum, network and impedance analysis, scripting in TypeScript and an MCP server for agents.

Until the WaveForms runtime is wired in, every device is simulated (`src/renderer/src/sim`), so the whole UI runs without hardware.

## Develop

The design system lives in [robcholz/Geist](https://github.com/robcholz/Geist) and is linked by path, so clone it next to Oscillo:

```sh
git clone https://github.com/robcholz/Geist.git
git clone https://github.com/robcholz/Oscillo.git
cd Oscillo
npm install
npm run dev          # run the app with hot reload
npm run typecheck
npm test
npm run dist:mac     # .dmg in dist/
```

`npm run screenshot` builds the app and saves a screenshot of every page to `screenshots/` (Linux needs `xvfb-run`; set `THEME=light` for the light theme).

## Layout

| Path | What |
| --- | --- |
| `src/main` | Electron main process: the window and native theme |
| `src/preload` | The `window.oscillo` bridge |
| `src/renderer/src/shell` | Title bar, sidebar, status bar, ⌘K search, shortcuts |
| `src/renderer/src/views` | One file per page |
| `src/renderer/src/components` | App pieces built from Geist: the plot, page layout, settings panel, unit inputs |
| `src/renderer/src/sim` | Simulated instruments and DSP helpers |

Components that aren't specific to Oscillo go into Geist, not here.
