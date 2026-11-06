// Copies the macOS WaveForms SDK (dwf.framework) into libs/dwf/macos, where the app bundles it from.
//   node scripts/copy-dwf.mjs [path/to/dwf.framework]   copy (default: the WaveForms install)
//   node scripts/copy-dwf.mjs --check                   fail if the bundled copy is missing
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'libs', 'dwf', 'macos', 'dwf.framework')
const arg = process.argv[2]

if (arg === '--check') {
  if (!existsSync(join(dest, 'dwf'))) {
    console.error(`Missing ${dest}.\nInstall WaveForms, then run: npm run sdk:mac`)
    process.exit(1)
  }
  process.exit(0)
}

const from = arg ?? ['/Library/Frameworks/dwf.framework', '/Applications/WaveForms.app/Contents/Frameworks/dwf.framework'].find((p) => existsSync(join(p, 'dwf')))
if (!from || !existsSync(join(from, 'dwf'))) {
  console.error('dwf.framework not found. Install WaveForms from digilent.com, or pass the framework path.')
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
// verbatimSymlinks keeps the framework's Versions/Current links as links.
cpSync(from, dest, { recursive: true, verbatimSymlinks: true })
console.log(`Copied ${from} to ${dest}`)
