// electron-builder artifactBuildCompleted hook: recompresses the dmg with LZMA (ULMO).
// electron-builder only offers zlib and bzip2; LZMA makes the download about a quarter smaller.
// ULMO needs macOS 10.15, below what Electron itself requires.
const { execFileSync } = require('node:child_process')
const { renameSync, rmSync, statSync } = require('node:fs')

module.exports = async function afterDmg({ file }) {
  if (!file?.endsWith('.dmg')) return
  const tmp = file.replace(/\.dmg$/, '.lzma.dmg')
  rmSync(tmp, { force: true })
  const before = statSync(file).size
  execFileSync('hdiutil', ['convert', file, '-format', 'ULMO', '-o', tmp, '-quiet'])
  renameSync(tmp, file)
  const mb = (n) => (n / 1e6).toFixed(1)
  console.log(`  • recompressed ${file} with LZMA  ${mb(before)} MB -> ${mb(statSync(file).size)} MB`)
}
