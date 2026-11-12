// Pixel Blast background, ported from React Bits (reactbits.dev/backgrounds/pixel-blast, MIT + Commons Clause).
// The shaders are the original ones. The JS keeps only what the Welcome page uses: the "classic" preset
// (hard square pixels, no glow, twinkle, drift or hover), the intro blast and click ripples.
// Colours come from CSS (--blast-color, --blast-accent on the container) so the pattern follows the theme.

const MAX_CLICKS = 10
const INTRO_SECONDS = 1.8
const bayer2 = (x: number, y: number): number => (Math.floor(x) / 2 + Math.floor(y) * Math.floor(y) * 0.75) % 1
const bayer8 = (x: number, y: number): number => (bayer2(x / 4, y / 4) * 0.25 + bayer2(x / 2, y / 2)) * 0.25 + bayer2(x, y)
const BAYER_TABLE = Array.from({ length: 64 }, (_, i) => bayer8(i % 8, Math.floor(i / 8)).toFixed(6)).join(', ')
const RANGE_MIN = -6
const RANGE_MAX = 10

export interface PixelBlastOptions {
  pixelSize: number
  patternScale: number
  patternDensity: number
  speed: number
  edgeFade: number
  rippleSpeed: number
  rippleThickness: number
  rippleIntensityScale: number
  /** Highest device pixel ratio to render at. */
  maxRatio?: number
  /** Hold the pattern still while the window is not focused (after the intro and any ripples). */
  pauseUnfocused?: boolean
}

/** Finn's settings: reactbits.dev/backgrounds/pixel-blast?preset=classic&pixelSize=4&speed=0.1&rippleIntensityScale=0.5 */
export const WELCOME_BLAST: PixelBlastOptions = {
  pixelSize: 4,
  patternScale: 2,
  patternDensity: 1,
  speed: 0.1,
  edgeFade: 0.25,
  rippleSpeed: 0.3,
  rippleThickness: 0.1,
  rippleIntensityScale: 0.5
}

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const PACKING = `
const float RANGE_MIN = ${RANGE_MIN.toFixed(1)};
const float RANGE_MAX = ${RANGE_MAX.toFixed(1)};
vec2 pack16(float value) {
  float x = floor(clamp((value - RANGE_MIN) / (RANGE_MAX - RANGE_MIN), 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(x / 256.0);
  return vec2(hi, x - hi * 256.0) / 255.0;
}
float unpack16(vec2 c) {
  float x = floor(c.x * 255.0 + 0.5) * 256.0 + floor(c.y * 255.0 + 0.5);
  return RANGE_MIN + x / 65535.0 * (RANGE_MAX - RANGE_MIN);
}
`

// One texel per 8x8 block of pixels: the cloud value, packed to 16 bits.
const CELL_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform vec2 uClickPos[${MAX_CLICKS}];
uniform float uClickAge[${MAX_CLICKS}];
uniform ivec2 uOrigin;
uniform float uIntro;
out vec4 outCell;
${PACKING}
float hash11(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n100 = hash11(dot(ip + vec3(1.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n010 = hash11(dot(ip + vec3(0.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n110 = hash11(dot(ip + vec3(1.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n001 = hash11(dot(ip + vec3(0.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n101 = hash11(dot(ip + vec3(1.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n011 = hash11(dot(ip + vec3(0.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n111 = hash11(dot(ip + vec3(1.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  vec3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0 = mix(x00, x10, w.y);
  float y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}
float fbm2(vec2 uv, float t) {
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < 5; ++i) {
    sum += amp * vnoise(p * freq);
    freq *= 1.25;
    amp *= 1.0;
  }
  return sum * 0.5 + 0.5;
}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float aspectRatio = uResolution.x / uResolution.y;
  float cellPixelSize = 8.0 * uPixelSize;
  vec2 cellId = vec2(texel + uOrigin);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);
  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;
  float feed = base + (uDensity - 0.5) * 0.3;
  for (int i = 0; i < ${MAX_CLICKS}; ++i) {
    vec2 pos = uClickPos[i];
    if (pos.x < 0.0) continue;
    vec2 cuv = (((pos - uResolution * 0.5 - cellPixelSize * 0.5) / uResolution)) * vec2(aspectRatio, 1.0);
    float t = max(uClickAge[i], 0.0);
    float r = distance(uv, cuv);
    float waveR = uRippleSpeed * t;
    float ring = exp(-pow((r - waveR) / uRippleThickness, 2.0));
    float atten = exp(-1.0 * t) * exp(-10.0 * r);
    feed = max(feed, ring * atten * uRippleIntensity);
  }
  if (uIntro < 1.0) {
    vec2 center = (-cellPixelSize * 0.5 / uResolution) * vec2(aspectRatio, 1.0);
    float reach = length(vec2(aspectRatio, 1.0)) * 0.5 + 0.2;
    float eased = 1.0 - pow(1.0 - uIntro, 2.4);
    float front = eased * reach;
    float r = distance(uv, center);
    float shown = smoothstep(front + 0.04, front - 0.06, r);
    float ring = exp(-pow((r - front) / 0.07, 2.0)) * (1.0 - uIntro);
    feed = mix(-1.0, feed, shown);
    feed = max(feed, ring * 1.4);
  }
  outCell = vec4(pack16(feed), clamp((feed + 0.5) * 0.5, 0.0, 1.0), 0.0);
}`

// Square pixels, ordered (Bayer) dither, no softness, smoothing, glow or twinkle.
const MAIN_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec2 uResolution;
uniform float uPixelSize;
uniform float uEdgeFade;
uniform sampler2D uCells;
uniform ivec2 uOrigin;
uniform ivec2 uCellCount;
out vec4 fragColor;
${PACKING}
const float BAYER[64] = float[64](${BAYER_TABLE});
void main() {
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  ivec2 texel = clamp(ivec2(cellId) - uOrigin, ivec2(0), uCellCount - 1);
  vec2 smoothAt = (fragCoord / cellPixelSize - vec2(uOrigin)) / vec2(uCellCount);
  float smoothFeed = texture(uCells, smoothAt).b * 2.0 - 0.5;
  float feed = unpack16(texelFetch(uCells, texel, 0).rg);
  if (feed < 0.0 && smoothFeed < 0.2) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 pixelId = floor(fragCoord / pixelSize);
  ivec2 cellBits = ivec2(mod(pixelId, 8.0));
  float bayer = BAYER[cellBits.y * 8 + cellBits.x] - 0.5;
  float M = step(0.0, feed + bayer - 0.5);
  float fade = 1.0;
  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    vec2 edgeA = clamp(norm / uEdgeFade, 0.0, 1.0);
    vec2 edgeB = clamp((1.0 - norm) / uEdgeFade, 0.0, 1.0);
    vec2 sa = edgeA * edgeA * edgeA * (edgeA * (edgeA * 6.0 - 15.0) + 10.0);
    vec2 sb = edgeB * edgeB * edgeB * (edgeB * (edgeB * 6.0 - 15.0) + 10.0);
    fade *= sa.x * sa.y * sb.x * sb.y;
  }
  M = clamp(M, 0.0, 1.0) * fade;
  float density = clamp(smoothFeed, 0.0, 1.0);
  float tone = smoothstep(0.3, 1.0, density) * 0.85;
  vec3 color = mix(uColor, uAccent, tone);
  fragColor = vec4(color * M, M);
}`

type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

function link(gl: WebGL2RenderingContext, fragment: string): Program | null {
  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
    gl.deleteShader(s)
    return null
  }
  const v = compile(gl.VERTEX_SHADER, VERTEX)
  const f = compile(gl.FRAGMENT_SHADER, fragment)
  const program = gl.createProgram()
  if (!v || !f || !program) return null
  gl.attachShader(program, v)
  gl.attachShader(program, f)
  gl.linkProgram(program)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const u: Program['u'] = {}
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)
    if (!info) continue
    const name = info.name.replace(/\[0\]$/, '')
    u[name] = gl.getUniformLocation(program, name)
  }
  return { program, u }
}

/** Any CSS colour to linear 0..1 RGB, via the browser's own parser. */
const rgbCache = new Map<string, [number, number, number]>()
function toRgb(css: string): [number, number, number] {
  const hit = rgbCache.get(css)
  if (hit) return hit
  const c = document.createElement('canvas').getContext('2d')
  let out: [number, number, number] = [1, 1, 1]
  if (c) {
    c.fillStyle = '#fff'
    c.fillStyle = css
    const hex = String(c.fillStyle)
    const m = /^#([0-9a-f]{6})$/i.exec(hex) ?? null
    if (m) {
      const n = parseInt(m[1], 16)
      out = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    } else {
      const p = /rgba?\(([^)]+)\)/.exec(hex)
      if (p) {
        const [r, g, b] = p[1].split(',').map((x) => parseFloat(x) / 255)
        out = [r, g, b]
      }
    }
  }
  if (rgbCache.size > 32) rgbCache.clear()
  rgbCache.set(css, out)
  return out
}

/** True when the app or macOS asks for less motion. The app's own setting wins over the system's. */
function reducedMotion(): boolean {
  const m = document.documentElement.dataset.motion
  if (m === 'reduced') return true
  if (m === 'on') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Draws the pattern into `canvas`, sized to `container`. Clicks inside the container send a ripple.
 * Returns a cleanup function. Does nothing when WebGL 2 is not available.
 */
export function mountPixelBlast(container: HTMLElement, canvas: HTMLCanvasElement, opts: PixelBlastOptions = WELCOME_BLAST): () => void {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
  if (!gl) return () => {}
  const cell = link(gl, CELL_FRAGMENT)
  const main = link(gl, MAIN_FRAGMENT)
  if (!cell || !main) return () => {}
  const vao = gl.createVertexArray()
  const targets = [0, 1].map(() => {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  })
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  const view = { w: 1, h: 1, ratio: 1 }
  const cells = { x: 0, y: 0, w: 1, h: 1, key: '' }
  const clickPos = new Float32Array(MAX_CLICKS * 2).fill(-1)
  const clickAt = new Float32Array(MAX_CLICKS)
  const clickAge = new Float32Array(MAX_CLICKS)
  let clickIndex = 0
  let current = 0
  const timeOffset = Math.random() * 1000
  let elapsed = 0
  let clock = 0
  let intro = reducedMotion() ? 1 : 0
  let raf = 0
  let last = 0
  let visible = true

  const layoutCells = (): void => {
    const cps = 8 * opts.pixelSize * view.ratio
    const w = canvas.width
    const h = canvas.height
    const x0 = Math.floor((-w / 2 - cps) / cps)
    const x1 = Math.floor((w / 2 + cps) / cps)
    const y0 = Math.floor((-h / 2 - cps) / cps)
    const y1 = Math.floor((h / 2 + cps) / cps)
    const width = Math.max(1, Math.min(2048, x1 - x0 + 1))
    const height = Math.max(1, Math.min(2048, y1 - y0 + 1))
    const key = `${x0}:${y0}:${width}:${height}`
    if (key === cells.key) return
    Object.assign(cells, { key, x: x0, y: y0, w: width, h: height })
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
  }

  const step = (): void => {
    const u = cell.u
    const target = targets[1 - current]
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, cells.w, cells.h)
    gl.disable(gl.BLEND)
    gl.useProgram(cell.program)
    gl.uniform2f(u.uResolution, canvas.width, canvas.height)
    gl.uniform1f(u.uTime, timeOffset + elapsed * opts.speed)
    gl.uniform1f(u.uPixelSize, opts.pixelSize * view.ratio)
    gl.uniform1f(u.uScale, opts.patternScale)
    gl.uniform1f(u.uDensity, opts.patternDensity)
    gl.uniform1f(u.uRippleSpeed, opts.rippleSpeed)
    gl.uniform1f(u.uRippleThickness, opts.rippleThickness)
    gl.uniform1f(u.uRippleIntensity, opts.rippleIntensityScale)
    gl.uniform2fv(u.uClickPos, clickPos)
    gl.uniform1fv(u.uClickAge, clickAge)
    gl.uniform2i(u.uOrigin, cells.x, cells.y)
    gl.uniform1f(u.uIntro, intro)
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    current = 1 - current
  }

  // Colours are read from CSS once per theme change, not every frame.
  let color: [number, number, number] = [1, 1, 1]
  let accent: [number, number, number] = [1, 1, 1]
  const readColors = (): void => {
    const cs = getComputedStyle(container)
    const c = cs.getPropertyValue('--blast-color').trim() || '#94a3b8'
    color = toRgb(c)
    accent = toRgb(cs.getPropertyValue('--blast-accent').trim() || c)
  }
  readColors()

  const draw = (): void => {
    const u = main.u
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(main.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture)
    gl.uniform1i(u.uCells, 0)
    gl.uniform3fv(u.uColor, color)
    gl.uniform3fv(u.uAccent, accent)
    gl.uniform2f(u.uResolution, canvas.width, canvas.height)
    gl.uniform1f(u.uPixelSize, opts.pixelSize * view.ratio)
    gl.uniform1f(u.uEdgeFade, opts.edgeFade)
    gl.uniform2i(u.uOrigin, cells.x, cells.y)
    gl.uniform2i(u.uCellCount, cells.w, cells.h)
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  const rippling = (): boolean => {
    for (let k = 0; k < MAX_CLICKS; k++) if (clickPos[k * 2] >= 0 && clickAge[k] < 8) return true
    return false
  }

  // The clouds move slowly, so once the intro and any ripples settle the loop drops to 30 fps.
  const frame = (now: number): void => {
    raf = 0
    if (!visible || document.hidden) return
    const still = reducedMotion()
    const calm = intro >= 1 && !rippling()
    if (calm && last && now - last < 1000 / 30 - 2) {
      raf = requestAnimationFrame(frame)
      return
    }
    const dt = last ? Math.min(Math.max((now - last) / 1000, 0), 1 / 20) : 0
    last = now
    if (!still) elapsed += dt
    clock += dt
    for (let k = 0; k < MAX_CLICKS; k++) clickAge[k] = (clock - clickAt[k]) * 0.5
    layoutCells()
    step()
    draw()
    if (intro < 1) intro = still ? 1 : Math.min(1, intro + dt / INTRO_SECONDS)
    const held = opts.pauseUnfocused && !document.hasFocus()
    if ((!still && !held) || intro < 1 || rippling()) raf = requestAnimationFrame(frame)
  }

  const wake = (): void => {
    if (!raf && visible && !document.hidden) {
      last = 0
      raf = requestAnimationFrame(frame)
    }
  }

  const resize = (): void => {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    const ratio = Math.min(window.devicePixelRatio || 1, opts.maxRatio ?? 2)
    if (w === view.w && h === view.h && ratio === view.ratio && canvas.width > 1) return
    view.w = w
    view.h = h
    view.ratio = ratio
    canvas.width = Math.max(1, Math.round(w * ratio))
    canvas.height = Math.max(1, Math.round(h * ratio))
    layoutCells()
    step()
    draw()
    wake()
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (reducedMotion()) return
    const r = container.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (x < 0 || y < 0 || x > r.width || y > r.height) return
    clickPos[clickIndex * 2] = x * view.ratio
    clickPos[clickIndex * 2 + 1] = (view.h - y) * view.ratio
    clickAt[clickIndex] = clock
    clickIndex = (clickIndex + 1) % MAX_CLICKS
    wake()
  }

  // Theme and motion changes land on <html> attributes; redraw so a paused pattern recolours too.
  const onAttr = (): void => {
    readColors()
    draw()
    wake()
  }
  const attrs = new MutationObserver(onAttr)
  attrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-motion', 'class', 'style'] })
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting)
    if (visible) wake()
  })
  io.observe(container)
  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('focus', wake)
  document.addEventListener('visibilitychange', wake)
  resize()

  return () => {
    cancelAnimationFrame(raf)
    attrs.disconnect()
    ro.disconnect()
    io.disconnect()
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('focus', wake)
    document.removeEventListener('visibilitychange', wake)
    for (const t of targets) {
      gl.deleteTexture(t.texture)
      gl.deleteFramebuffer(t.framebuffer)
    }
    gl.deleteVertexArray(vao)
    gl.deleteProgram(cell.program)
    gl.deleteProgram(main.program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
