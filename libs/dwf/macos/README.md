# macOS SDK

`dwf.framework` here is the WaveForms SDK for macOS (universal: Apple silicon and Intel). Oscillo
bundles it into `Oscillo.app/Contents/Frameworks`, so the app runs real devices on Macs without
WaveForms installed. During `npm run dev` the app loads it from this folder.

Refresh it from a Mac with WaveForms installed:

```sh
npm run sdk:mac            # copies /Library/Frameworks/dwf.framework
```

`npm run dist:mac` stops if the framework is missing.
