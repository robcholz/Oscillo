// A small, safe expression language for math channels: + - * / ^, parentheses, numbers,
// channel names (C1, C2, R1…) and abs sqrt sin cos exp log min max. No eval.
export type Env = Record<string, number>
type Node = (env: Env) => number

const fns: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  exp: Math.exp,
  log: Math.log,
  min: Math.min,
  max: Math.max
}

export function compile(src: string): Node {
  const toks = src.match(/\s*([A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[-+*/^(),])/g)
  if (!toks || toks.join('').replace(/\s/g, '') !== src.replace(/\s/g, '')) throw new Error('Unexpected character in formula')
  const t = toks.map((x) => x.trim())
  let i = 0
  const peek = (): string | undefined => t[i]
  const take = (s?: string): string => {
    const v = t[i++]
    if (s && v !== s) throw new Error(`Expected “${s}”`)
    if (v === undefined) throw new Error('Formula ends too early')
    return v
  }
  const expr = (): Node => {
    let l = term()
    while (peek() === '+' || peek() === '-') {
      const op = take()
      const r = term()
      const a = l
      l = op === '+' ? (e) => a(e) + r(e) : (e) => a(e) - r(e)
    }
    return l
  }
  const term = (): Node => {
    let l = power()
    while (peek() === '*' || peek() === '/') {
      const op = take()
      const r = power()
      const a = l
      l = op === '*' ? (e) => a(e) * r(e) : (e) => a(e) / r(e)
    }
    return l
  }
  const power = (): Node => {
    const b = unary()
    if (peek() === '^') {
      take()
      const x = power()
      return (e) => b(e) ** x(e)
    }
    return b
  }
  const unary = (): Node => {
    if (peek() === '-') {
      take()
      const u = unary()
      return (e) => -u(e)
    }
    if (peek() === '+') take()
    return atom()
  }
  const atom = (): Node => {
    const v = take()
    if (v === '(') {
      const x = expr()
      take(')')
      return x
    }
    if (/^[\d.]/.test(v)) {
      const n = Number(v)
      return () => n
    }
    if (peek() === '(') {
      const f = fns[v.toLowerCase()]
      if (!f) throw new Error(`Unknown function ${v}()`)
      take('(')
      const args: Node[] = [expr()]
      while (peek() === ',') {
        take()
        args.push(expr())
      }
      take(')')
      return (e) => f(...args.map((a) => a(e)))
    }
    const name = v.toUpperCase()
    return (e) => {
      if (!(name in e)) throw new Error(`Unknown channel ${v}`)
      return e[name]
    }
  }
  const root = expr()
  if (i < t.length) throw new Error(`Unexpected “${t[i]}”`)
  return root
}

/** Returns an error message, or null when the formula is valid for these channels. */
export function check(src: string, channels: string[]): string | null {
  try {
    const f = compile(src)
    f(Object.fromEntries(channels.map((c) => [c, 1])))
    return null
  } catch (e) {
    return (e as Error).message
  }
}
