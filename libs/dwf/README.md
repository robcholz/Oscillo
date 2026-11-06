# @oscillo/dwf

Oscillo's backend for Digilent devices. It wraps the WaveForms SDK (`libdwf`), which ships with WaveForms.

- `include/dwf.h` is the SDK header, copied from `macos/dwf.framework`. `npm run gen` turns it into `src/generated.ts`, which holds every constant, the C prototypes and a typed `DwfRaw` interface for all ~520 functions.
- `macos/dwf.framework` is the macOS SDK (universal: arm64 and x86_64), bundled into Oscillo.app.
- `loadDwf()` binds the installed library with [koffi](https://koffi.dev). It looks in the standard install locations:
  - macOS: `/Library/Frameworks/dwf.framework/dwf`
  - Linux: `libdwf.so`
  - Windows: `dwf.dll`
- `Dwf` and `Device` are the typed API the app uses: enumerate and open devices, scope (AnalogIn), wavegen (AnalogOut), supplies and monitors (AnalogIO), and static I/O (DigitalIO). A failed call throws `DwfError` with the SDK's message.
- `createSimDwf()` is an in-memory Analog Discovery 3 behind the same `DwfRaw` interface. The app runs without hardware, and tests drive the real wrapper code.

```ts
import { Dwf, loadDwf, createSimDwf } from '@oscillo/dwf'

const dwf = new Dwf(hasWaveForms ? loadDwf() : createSimDwf())
const dev = dwf.open(0)
dev.wavegen.set(0, { func: 'Sine', frequency: 1e3, amplitude: 1 })
const { data } = await dev.scope.single({ channels: [0], rate: 1e6, samples: 8192 })
dev.close()
```
