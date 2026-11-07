// Checks that a packaged app still has what the trimmed bundle must keep. Run it with the app's own
// binary in Node mode:
//   ELECTRON_RUN_AS_NODE=1 Oscillo.app/Contents/MacOS/Oscillo scripts/check-app.cjs Oscillo.app
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

const app = resolve(process.argv[2])
const mac = app.endsWith('.app')
const resources = mac ? join(app, 'Contents', 'Resources') : join(app, 'resources')
const req = (m) => require(join(resources, 'app.asar', 'node_modules', m))
const libDir = join(resources, 'typescript')

// Script's type checker: typescript loads and finds its standard library in Resources.
const ts = req('typescript')
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts'], types: [], strict: true, noEmit: true }
const host = ts.createCompilerHost(options)
// As src/main/script-compile.ts does in the app.
host.getDefaultLibLocation = () => libDir
host.getDefaultLibFileName = (o) => join(libDir, ts.getDefaultLibFileName(o))
const get = host.getSourceFile
const src = 'const n: number = "x"; new Map<string, number>(); [1].at(0); Object.hasOwn({}, "a"); export {}'
host.getSourceFile = (name, lang, ...rest) => (name === '/check.ts' ? ts.createSourceFile(name, src, lang) : get(name, lang, ...rest))
const exists = host.fileExists
host.fileExists = (name) => name === '/check.ts' || exists(name)
const program = ts.createProgram(['/check.ts'], options, host)
const diags = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSemanticDiagnostics()].map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
if (diags.length !== 1 || !diags[0].includes("'string' is not assignable to type 'number'")) throw new Error(`typescript: unexpected diagnostics ${JSON.stringify(diags)}`)
console.log('typescript ok', ts.version)

// The WaveForms SDK loads, and its USB stack enumerates.
const koffi = req('koffi')
console.log('koffi ok', koffi.version ?? '')
if (mac) {
  const path = join(app, 'Contents', 'Frameworks', 'dwf.framework', 'dwf')
  if (!existsSync(path)) throw new Error(`missing ${path}`)
  const lib = koffi.load(path)
  const version = Buffer.alloc(32)
  if (!lib.func('int FDwfGetVersion(char *szVersion)')(version)) throw new Error('FDwfGetVersion failed')
  const count = [0]
  if (!lib.func('int FDwfEnum(int enumfilter, _Out_ int *pcDevice)')(0, count)) throw new Error('FDwfEnum failed')
  console.log('dwf ok', version.toString('latin1').replace(/\0.*$/s, ''), `devices=${count[0]}`)
}
