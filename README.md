# Oscillo

A test and measurement app for Digilent instruments on macOS: oscilloscope, waveform generator, supplies, logic analyzer, protocol tools, spectrum, network and impedance analysis, scripting in TypeScript and an MCP server for agents.

Instruments talk to devices through the WaveForms SDK. Without hardware, pick the **Demo Device**: a simulated Analog Discovery 3 behind the same SDK interface (`libs/dwf/src/sim.ts`), with a test board on its pins (`libs/dwf/src/sim-board.ts`). The app has no demo code paths of its own; the Demo Device takes exactly the path a real one does.

## Develop

The design system comes from [robcholz/Geist](https://github.com/robcholz/Geist), vendored in `geist/`.

```sh
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
| `src/main` | Electron main process: the window, menus, device access (`hardware.ts`), scripting and the MCP server |
| `src/preload` | The `window.oscillo` bridge |
| `src/renderer/src/shell` | Title bar, sidebar, status bar, ⌘K search, shortcuts |
| `src/renderer/src/views` | One file per page |
| `src/renderer/src/components` | App pieces built from Geist: the plot, page layout, settings panel, unit inputs |
| `src/shared/dsp` | Analysis shared by both processes: FFT, spectrum metrics, scope measurements, logic decoders |
| `libs/dwf` | Typed WaveForms SDK bindings, the instrument wrappers and the simulated device |

Components that aren't specific to Oscillo go into Geist, not here.
