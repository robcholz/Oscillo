# Geist

The design system shared by [Tether](https://github.com/robcholz/Tether) and Oscillo: React components, color and spacing tokens, base styles and the Geist fonts. It holds no app code. [vercel.com/geist](https://vercel.com/geist) is the reference; components keep the prop names shown there (for example Button `type`, not `variant`).

## Use it in an app

Clone it next to the app, so the folders sit side by side:

```sh
git clone https://github.com/robcholz/Geist.git
git clone https://github.com/robcholz/Tether.git
```

The app depends on it by path, so edits here show up in the app straight away:

```json
"dependencies": { "@robcholz/geist": "file:../Geist" }
```

Geist ships TypeScript source; the app's Vite build compiles it. In the app:

```css
/* main stylesheet */
@import 'tailwindcss';
@import '@robcholz/geist/styles.css';
```

```ts
// renderer entry
import '@robcholz/geist/focus-modality'
import { Button, Modal, Select } from '@robcholz/geist'
```

Two settings keep a single copy of React and Radix when Geist is linked from outside the app:

```ts
// electron.vite.config.ts / vite.config.ts
resolve: { dedupe: ['react', 'react-dom', 'radix-ui', 'cmdk', 'clsx'] }
```

```json
// tsconfig for the renderer
"compilerOptions": { "preserveSymlinks": true }
```

## What's here

| Path | |
| --- | --- |
| `src/` | Components, `cn`, and `focus-modality.ts` (shows the focus ring only after keyboard use) |
| `styles/index.css` | Fonts, tokens and base styles in one import, plus `@source` so Tailwind sees the components' classes |
| `styles/tokens.css` | CSS variables for dark and light (`<html data-theme>`) and the Tailwind `@theme` mapping. Generated |
| `tokens/tokens.json` | The source of the tokens. Edit this, then `npm run tokens` |
| `fonts/` | Geist and Geist Mono variable fonts, SIL Open Font License 1.1 |

## Adding a component

If an app needs a component that isn't here, add it here rather than in the app. Match the component's page on vercel.com/geist for props, sizes and states, export it from `src/index.ts`, and run `npm run typecheck`.
