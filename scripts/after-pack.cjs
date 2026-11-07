// electron-builder afterPack hook: trims the bundled WaveForms SDK to what this build can use.
// The copy in libs/dwf/macos stays universal so development works on any Mac.
const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { Arch } = require('builder-util')

const LIPO_ARCH = { x64: 'x86_64', arm64: 'arm64' }

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const want = LIPO_ARCH[Arch[context.arch]]
  // A universal build merges the x64 and arm64 apps, so both slices stay.
  if (!want) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const sdk = join(app, 'Contents', 'Frameworks', 'dwf.framework', 'Versions', 'A')
  const binaries = [join(sdk, 'dwf'), ...readdirSync(join(sdk, 'Frameworks')).filter((f) => f.endsWith('.dylib')).map((f) => join(sdk, 'Frameworks', f))]
  for (const file of binaries) {
    const archs = execFileSync('lipo', ['-archs', file]).toString().trim().split(/\s+/)
    if (archs.length < 2) continue
    if (!archs.includes(want)) throw new Error(`${file} has no ${want} slice (${archs.join(', ')})`)
    // -thin copies the slice as is, so its code signature stays valid.
    execFileSync('lipo', [file, '-thin', want, '-output', file])
  }
  console.log(`  • thinned dwf.framework to ${want}  binaries=${binaries.length}`)
}
