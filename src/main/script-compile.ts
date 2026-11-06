// Type-checks Script's TypeScript against the Oscillo API, and compiles it with a line hook before
// every statement (for breakpoints, stepping and the Variables table).
import ts from 'typescript'
import { OSCILLO_DTS } from '../shared/oscillo-types'
import type { Problem } from '../shared/script'

const ROOT = '/workspace/'
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts'],
  types: [],
  strict: true,
  noEmit: true,
  skipLibCheck: true
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1))
  return d[a.length][b.length]
}

/** Type-checks `file` and what it imports. */
export function check(files: Record<string, string>, file: string): Problem[] {
  const virt = new Map<string, string>()
  for (const [n, code] of Object.entries(files)) if (n.endsWith('.ts') && !n.endsWith('.d.ts')) virt.set(ROOT + n, code)
  virt.set(ROOT + 'oscillo.d.ts', OSCILLO_DTS)
  const host = ts.createCompilerHost(OPTIONS)
  const getSourceFile = host.getSourceFile
  host.getSourceFile = (name, lang, onError, create) => (virt.has(name) ? ts.createSourceFile(name, virt.get(name)!, lang) : getSourceFile(name, lang, onError, create))
  const fileExists = host.fileExists
  host.fileExists = (name) => virt.has(name) || (!name.startsWith(ROOT) && fileExists(name))
  const readFile = host.readFile
  host.readFile = (name) => virt.get(name) ?? (name.startsWith(ROOT) ? undefined : readFile(name))
  host.getCurrentDirectory = () => ROOT
  const dirExists = host.directoryExists?.bind(host)
  host.directoryExists = (d) => ROOT.startsWith(d.endsWith('/') ? d : d + '/') || (!d.startsWith(ROOT) && (dirExists?.(d) ?? false))
  host.realpath = (p) => p
  const program = ts.createProgram([ROOT + file, ROOT + 'oscillo.d.ts'], OPTIONS, host)
  const checker = program.getTypeChecker()
  const diags = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].filter((d) => d.file?.fileName.startsWith(ROOT) && !d.file.fileName.endsWith('.d.ts'))
  return diags.map((d) => {
    const sf = d.file!
    const pos = sf.getLineAndCharacterOfPosition(d.start ?? 0)
    let message = ts.flattenDiagnosticMessageText(d.messageText, ' ')
    let fix: Problem['fix']
    // A string literal that isn't one of the allowed literals: suggest the closest one.
    const node = findNode(sf, d.start ?? 0)
    if (node && ts.isStringLiteral(node)) {
      const want = checker.getContextualType(node)
      const options = want?.isUnion() ? want.types.filter((t) => t.isStringLiteral()).map((t) => (t as ts.StringLiteralType).value) : want?.isStringLiteral() ? [want.value] : []
      if (options.length) {
        const best = options.reduce((a, b) => (distance(node.text, a) <= distance(node.text, b) ? a : b))
        if (distance(node.text, best) <= Math.max(2, best.length / 3)) {
          message += ` Did you mean "${best}"?`
          fix = { start: node.getStart(sf) + 1, end: node.end - 1, text: best, title: `Change to "${best}"` }
        }
      }
    }
    return { file: sf.fileName.slice(ROOT.length), line: pos.line + 1, col: pos.character + 1, message, code: d.code, fix }
  })
}

function findNode(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (n: ts.Node): void => {
    if (pos >= n.getStart(sf) && pos < n.end) {
      found = n
      ts.forEachChild(n, visit)
    }
  }
  visit(sf)
  return found
}

/** Names bound by a declaration or parameter (including destructuring). */
function bound(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bound(e.name)))
}

/** Inserts `await __rt.line(file, line, () => ({ ...names in scope }))` before each statement. */
function instrument(file: string): ts.TransformerFactory<ts.SourceFile> {
  return (ctx) => (sf) => {
    const f = ctx.factory
    const scopes: string[][] = [[]]
    const hook = (s: ts.Node): ts.Statement => {
      const line = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1
      const names = [...new Set(scopes.flat())]
      const vars = f.createArrowFunction(undefined, undefined, [], undefined, undefined, f.createParenthesizedExpression(f.createObjectLiteralExpression(names.map((n) => f.createShorthandPropertyAssignment(n)))))
      return f.createExpressionStatement(f.createAwaitExpression(f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__rt'), 'line'), undefined, [f.createStringLiteral(file), f.createNumericLiteral(line), vars])))
    }
    const skip = (s: ts.Statement) => ts.isFunctionDeclaration(s) || ts.isImportDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s) || ts.isEmptyStatement(s) || ts.isExportDeclaration(s)
    const statements = (list: ts.NodeArray<ts.Statement>, canAwait: boolean): ts.Statement[] => {
      const out: ts.Statement[] = []
      // Function and class declarations are hoisted, so their names are in scope from the start.
      for (const s of list) if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) scopes[scopes.length - 1].push(s.name.text)
      for (const s of list) {
        if (canAwait && !skip(s)) out.push(hook(s))
        out.push(visit(s, canAwait) as ts.Statement)
        if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) scopes[scopes.length - 1].push(...bound(d.name))
      }
      return out
    }
    const scoped = <T>(names: string[], fn: () => T): T => {
      scopes.push(names)
      try {
        return fn()
      } finally {
        scopes.pop()
      }
    }
    const visit = (node: ts.Node, canAwait: boolean): ts.Node => {
      if (ts.isBlock(node)) return scoped([], () => f.updateBlock(node, statements(node.statements, canAwait)))
      if (ts.isCaseClause(node)) return f.updateCaseClause(node, visit(node.expression, canAwait) as ts.Expression, statements(node.statements, canAwait))
      if (ts.isDefaultClause(node)) return f.updateDefaultClause(node, statements(node.statements, canAwait))
      if (ts.isFunctionLike(node)) {
        const isAsync = !!ts.getModifiers(node as ts.FunctionDeclaration)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        const params = node.parameters.flatMap((p) => bound(p.name))
        return scoped(params, () => ts.visitEachChild(node, (n) => visit(n, isAsync), ctx))
      }
      if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const init = node.initializer && ts.isVariableDeclarationList(node.initializer) ? node.initializer.declarations.flatMap((d) => bound(d.name)) : []
        return scoped(init, () => ts.visitEachChild(node, (n) => visit(n, canAwait), ctx))
      }
      return ts.visitEachChild(node, (n) => visit(n, canAwait), ctx)
    }
    return f.updateSourceFile(sf, statements(sf.statements, true))
  }
}

export function compile(code: string, file: string): string {
  return ts.transpileModule(code, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: false },
    transformers: { before: [instrument(file)] }
  }).outputText
}

