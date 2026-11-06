// Generates styles/tokens.css from tokens/tokens.json.
// Run with: npm run tokens
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tokens = JSON.parse(readFileSync(join(root, 'tokens/tokens.json'), 'utf8'))
const out = join(root, 'styles/tokens.css')

const dark = []
const light = []
for (const t of tokens.color.tokens) {
  const v = typeof t.value === 'string' ? { dark: t.value } : t.value
  dark.push(`  --${t.name}: ${v.dark};`)
  if (v.light) light.push(`  --${t.name}: ${v.light};`)
}

const plain = []
for (const family of ['spacing', 'size', 'radius', 'shadow']) {
  for (const t of tokens[family]?.tokens ?? []) plain.push(`  --${t.name}: ${t.value};`)
}

// Tailwind v4 theme: Geist colors replace Tailwind's palette so `bg-gray-100`
// means Geist gray-100, exactly like the Geist docs' class names.
const theme = [
  '  --color-*: initial;',
  '  --color-transparent: transparent;',
  '  --color-current: currentColor;',
  ...tokens.color.tokens.map((t) => `  --color-${t.name}: var(--${t.name});`),
  `  --font-sans: ${tokens.type.families.sans};`,
  `  --font-mono: ${tokens.type.families.mono};`,
  '  --radius-*: initial;',
  ...tokens.radius.tokens.map((t) => `  --radius-${t.name.replace('radius-', '')}: var(--${t.name});`),
  '  --shadow-*: initial;',
  ...tokens.shadow.tokens.map((t) => `  --shadow-${t.name.replace('shadow-', '')}: var(--${t.name});`)
]

const css = `/* Generated from tokens/tokens.json by scripts/gen-tokens.mjs. Do not edit by hand. */

:root,
:root[data-theme='dark'] {
  color-scheme: dark;
${dark.join('\n')}
${plain.join('\n')}
}

:root[data-theme='light'] {
  color-scheme: light;
${light.join('\n')}
}

@theme inline {
${theme.join('\n')}
}
`
writeFileSync(out, css)
console.log(`Wrote ${out}`)
