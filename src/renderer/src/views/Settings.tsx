// Settings (board: Settings). Section nav on the left that follows the scroll; each section is a card
// of option rows. Preferences live in usePrefs, theme in the app store.
import { Button, FormModal, Kbd, Material, Modal, Select, Slider, Snippet, Switch, ThemeSwitcher, Toggle, cn } from '@robcholz/geist'
import { BookOpen, Info, MessageSquare, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { OptionRow, PageBar } from '../components/Page'
import { usePrefs } from '../prefs'
import { files } from '../files'
import { useStore } from '../store'
import { checkRelease, REPO } from '../updates'
import { useCommand } from '../shell/commands'
import icon from '../assets/oscillo-icon.png'


const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'plots', label: 'Plots' },
  { id: 'region', label: 'Language and Region' },
  { id: 'startup', label: 'Startup' },
  { id: 'updates', label: 'Updates' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'cli', label: 'Command Line' },
  { id: 'help', label: 'Help' },
  { id: 'reset', label: 'Reset' }
] as const

// macOS order: ⌃ ⌥ ⇧ ⌘, then the key.
const SHORTCUTS: { a: string; k: string[][] }[] = [
  { a: 'Command Menu', k: [['⌘', 'K']] },
  { a: 'Open Scope, Wavegen, Supplies, Logic, Spectrum or Script', k: [['⌘', '1–6']] },
  { a: 'Open Settings', k: [['⌘', ',']] },
  { a: 'Run or Stop All', k: [['Space']] },
  { a: 'Single Capture', k: [['⌘', '↵']] },
  { a: 'Auto Set', k: [['⇧', '⌘', 'A']] },
  { a: 'Run Script', k: [['⌘', 'R']] },
  { a: 'Save Workspace', k: [['⌘', 'S']] },
  { a: 'Open Workspace', k: [['⌘', 'O']] },
  { a: 'Toggle Sidebar', k: [['⌘', 'B']] },
  { a: 'Show or Hide Settings Panel', k: [['⌥', '⌘', '0']] },
  { a: 'Undo or Redo in Wave and Pattern Editors', k: [['⌘', 'Z'], ['⇧', '⌘', 'Z']] },
  { a: 'Toggle Light and Dark', k: [['⇧', '⌘', 'L']] }
]

const COMMANDS = (exe: string) => [
  { label: 'Open a Workspace', desc: 'Starts with the workspace and its instruments.', cmd: `"${exe}" ~/Documents/Oscillo/Workspaces/Bench.oscillo` },
  { label: 'Run a Script', desc: 'No window. Prints the console; the exit code is 0 when the script finishes.', cmd: `"${exe}" --script measure.ts --timeout 60` },
  { label: 'Let a Script Use the Network and Files', desc: 'Adds fetch and lets File open any path.', cmd: `"${exe}" --script upload.ts --allow-net` },
  { label: 'MCP Over Stdio', desc: 'For MCP clients that launch their server. Oscillo must be running.', cmd: `"${exe}" --mcp-stdio` }
]

function Section({ id, title, description, children, danger }: { id: string; title: string; description?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-h`} className="flex scroll-mt-6 flex-col gap-3">
      <div>
        <h2 id={`settings-${id}-h`} className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">
          {title}
        </h2>
        {description && <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-gray-900">{description}</p>}
      </div>
      <Material className={cn('px-5 py-1', danger && 'shadow-[0_0_0_1px_var(--red-400)]!')}>{children}</Material>
    </section>
  )
}

const W = 'w-[200px]'

export function Settings() {
  const p = usePrefs()
  const app = useStore()
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string>('appearance')
  const [update, setUpdate] = useState<{ state: 'idle' | 'checking' | 'done'; at?: Date; result?: Awaited<ReturnType<typeof checkRelease>> }>({ state: 'idle' })
  const [ver, setVer] = useState<{ app: string; electron: string; exe: string } | null>(null)
  useEffect(() => void files?.version().then(setVer), [])
  const VERSION = ver?.app ?? '…'
  const [about, setAbout] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  // Menu bar items that land here (src/main/menu.ts).
  const jump = (id: string): void => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' })
  useCommand('about', () => setAbout(true))
  useCommand('feedback', () => setFeedback(true))
  useCommand('shortcuts', () => jump('shortcuts'))
  useCommand('check-updates', () => {
    jump('updates')
    void checkUpdates()
  })

  // The nav follows the section nearest the top of the scroll area.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = (): void => {
      const top = el.getBoundingClientRect().top + 48
      let cur: string = SECTIONS[0].id
      for (const s of SECTIONS) {
        const node = document.getElementById(`settings-${s.id}`)
        if (node && node.getBoundingClientRect().top <= top) cur = s.id
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) cur = SECTIONS[SECTIONS.length - 1].id
      setActive(cur)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const checkUpdates = async (): Promise<void> => {
    setUpdate({ state: 'checking' })
    setUpdate({ state: 'done', at: new Date(), result: await checkRelease() })
  }
  const r = update.result
  const updateFooter =
    update.state === 'checking'
      ? 'Checking for updates…'
      : update.state === 'done' && r
        ? 'error' in r
          ? r.error
          : r.newer
            ? `Version ${r.tag.replace(/^v/, '')} is available.`
            : `Oscillo is up to date. Checked at ${update.at!.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : p.autoUpdate
          ? 'Checks GitHub once a day at launch.'
          : 'Automatic checks are off.'

  const select = (label: string, value: string, options: readonly string[], on: (v: string) => void) => (
    <div className={W}>
      <Select size="small" aria-label={label} value={value} options={options} onValueChange={on} />
    </div>
  )
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const os = window.oscillo?.platform ?? navigator.platform
  const platform = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[os] ?? os

  return (
    <>
      <PageBar title="Settings" />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1120px] gap-10 px-4 pb-16 pt-6">
          <nav aria-label="Settings sections" className="sticky top-6 flex h-fit w-[176px] flex-none flex-col gap-0.5 max-[1080px]:hidden">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={active === s.id ? 'true' : undefined}
                onClick={() => {
                  document.getElementById(`settings-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActive(s.id)
                }}
                className={cn(
                  'flex h-8 cursor-pointer items-center rounded-small px-3 text-left text-sm transition-colors',
                  active === s.id ? 'bg-gray-alpha-100 font-medium text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000'
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="mx-auto flex min-w-0 max-w-[880px] flex-1 flex-col gap-10">
            <Section id="appearance" title="Appearance" description="How Oscillo looks on this computer.">
              <OptionRow label="Theme" description="System follows your operating system. Also in the top bar.">
                <ThemeSwitcher value={app.theme} onChange={app.setTheme} />
              </OptionRow>
              <OptionRow label="Font Size" description="Text size across every instrument.">
                {select('Font Size', p.fontSize, ['13 px', '14 px', '16 px'], (v) => p.set({ fontSize: v as typeof p.fontSize }))}
              </OptionRow>
              <OptionRow label="Animations" description="System follows Reduce Motion in macOS settings. Reduced keeps progress and status changes but drops motion.">
                <Switch aria-label="Animations" value={p.animations} options={['System', 'Reduced', 'On']} onChange={(animations) => p.set({ animations })} />
              </OptionRow>
            </Section>

            <Section id="plots" title="Plots" description="Rendering and pointer behavior for every plot.">
              <OptionRow label="Curve" description="Draw samples joined by straight lines or a smoothed curve.">
                <Switch aria-label="Curve" value={p.curve} options={['Linear', 'Smooth']} onChange={(curve) => p.set({ curve })} />
              </OptionRow>
              <OptionRow label="Plot Width" description="Stroke width for traces.">
                <div className={cn(W, 'flex items-center gap-3')}>
                  <Slider aria-label="Plot Width" className="flex-1" min={1} max={3} step={0.5} value={p.plotWidth} onChange={(plotWidth) => p.set({ plotWidth })} />
                  <span className="w-12 flex-none whitespace-nowrap text-right font-mono text-[13px] tabular-nums">{p.plotWidth.toFixed(1)} px</span>
                </div>
              </OptionRow>
              <OptionRow label="Mouse Wheel" description="What scrolling over a plot does.">
                {select('Mouse Wheel', p.wheel, ['Zoom', 'Scroll'], (v) => p.set({ wheel: v as typeof p.wheel }))}
              </OptionRow>
              <OptionRow label="Drag on Plot" description="What dragging inside a plot does.">
                {select('Drag on Plot', p.drag, ['Pan', 'Select Region'], (v) => p.set({ drag: v as typeof p.drag }))}
              </OptionRow>
              <OptionRow label="Hover Readout" description="Show a dashed line and the values under the pointer.">
                <Toggle aria-label="Hover Readout" checked={p.hover} onChange={(hover) => p.set({ hover })} />
              </OptionRow>
            </Section>

            <Section id="region" title="Language and Region" description="Number formats apply to readouts and exported files.">
              <OptionRow label="Decimal Symbol" description="For readouts and plot labels. Exported files have their own setting on the Export page.">{select('Decimal Symbol', p.decimal, ['Locale', 'Point', 'Comma'], (v) => p.set({ decimal: v as typeof p.decimal }))}</OptionRow>
            </Section>

            <Section id="startup" title="Startup">
              <OptionRow label="On Start" description="Where Oscillo opens. Instrument settings are always kept.">
                {select('On Start', p.onStart, ['Open Last Workspace', 'Open Welcome'], (onStart) => p.set({ onStart }))}
              </OptionRow>
            </Section>

            <Section id="updates" title="Updates">
              <OptionRow label="Check Automatically" description="Look for a new version once a day.">
                <Toggle aria-label="Check Automatically" checked={p.autoUpdate} onChange={(autoUpdate) => p.set({ autoUpdate })} />
              </OptionRow>
              <OptionRow label={`Version ${VERSION}`} description={<span aria-live="polite">{updateFooter}</span>}>
                <Button size="small" type="secondary" prefix={<RefreshCw size={16} />} loading={update.state === 'checking'} onClick={() => (r && 'newer' in r && r.newer ? void files?.external(r.url) : void checkUpdates())}>
                  {update.state === 'checking' ? 'Checking' : r && 'newer' in r && r.newer ? 'Download' : 'Check for Updates'}
                </Button>
              </OptionRow>
            </Section>

            <Section id="shortcuts" title="Keyboard Shortcuts" description="On Windows and Linux, Ctrl replaces ⌘.">
              {SHORTCUTS.map((s) => (
                <div key={s.a} className="flex h-11 items-center justify-between gap-4 [&+&]:shadow-[inset_0_1px_0_var(--gray-alpha-200)]">
                  <span className="text-sm">{s.a}</span>
                  <span className="flex gap-2" aria-label={s.k.map((c) => c.join('')).join(' or ')}>
                    {s.k.map((c) => (
                      <Kbd key={c.join('')} keys={c} />
                    ))}
                  </span>
                </div>
              ))}
            </Section>

            <Section id="cli" title="Command Line" description="Start Oscillo from a terminal or a CI job.">
              {COMMANDS(ver?.exe ?? 'Oscillo').map((c) => (
                <div key={c.cmd} className="flex flex-col gap-2 py-3 [&+&]:shadow-[inset_0_1px_0_var(--gray-alpha-200)]">
                  <div>
                    <div className="text-sm font-medium leading-5">{c.label}</div>
                    <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-gray-900">{c.desc}</p>
                  </div>
                  <Snippet text={c.cmd} onCopy={() => app.toast('Copied to clipboard', { detail: c.cmd })} />
                </div>
              ))}
            </Section>

            <Section id="help" title="Help">
              <OptionRow label="Documentation" description="Guides for every instrument and the scripting API.">
                <Button size="small" type="secondary" prefix={<BookOpen size={16} />} onClick={() => void files?.external(`https://github.com/${REPO}#readme`)}>
                  Open Documentation
                </Button>
              </OptionRow>
              <OptionRow label="Feedback" description="Tell us what is missing or broken.">
                <Button size="small" type="secondary" prefix={<MessageSquare size={16} />} onClick={() => setFeedback(true)}>
                  Send Feedback
                </Button>
              </OptionRow>
              <OptionRow label="About Oscillo" description="Version, licenses and runtime details.">
                <Button size="small" type="secondary" prefix={<Info size={16} />} onClick={() => setAbout(true)}>
                  About
                </Button>
              </OptionRow>
            </Section>

            <Section id="reset" title="Reset" danger>
              <OptionRow label="Reset All Settings" description="Every setting returns to its default. Workspaces and calibration are kept.">
                <Button size="small" type="error" onClick={() => setConfirmReset(true)}>
                  Reset Settings
                </Button>
              </OptionRow>
            </Section>
          </div>
        </div>
      </div>

      <FormModal
        open={feedback}
        onClose={() => setFeedback(false)}
        title="Send Feedback"
        description="Opens a new issue on GitHub with your version and platform filled in. Review it there, then submit."
        submitLabel="Continue on GitHub"
        fields={[
          { key: 'topic', label: 'Topic', type: 'select', options: ['Something Is Broken', 'Missing Feature', 'Other'] },
          { key: 'summary', label: 'Summary', placeholder: 'Scope trigger misses the first edge', required: true },
          { key: 'details', label: 'Details (Optional)', placeholder: 'What you did, what you expected, what happened' }
        ]}
        onSubmit={(v) => {
          setFeedback(false)
          const body = `${v.details || ''}\n\n---\nTopic: ${v.topic}\nOscillo ${VERSION} · Electron ${electron} · ${window.oscillo?.platform ?? navigator.platform}`
          void files?.external(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(v.summary)}&body=${encodeURIComponent(body.trim())}`)
        }}
      />

      <Modal
        open={about}
        onClose={() => setAbout(false)}
        title="About Oscillo"
        width={440}
        actions={
          <>
            <Button
              size="small"
              type="secondary"
              onClick={() => {
                const info = `Oscillo ${VERSION}\nElectron ${electron}\nChromium ${chrome}\nPlatform ${platform}`
                void navigator.clipboard.writeText(info).then(() => app.toast('Version info copied'))
              }}
            >
              Copy Version Info
            </Button>
            <Button size="small" onClick={() => setAbout(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <img src={icon} width={72} height={72} alt="" className="mb-2 block" />
          <span className="font-mono text-[13px] leading-5 text-gray-900">Version {VERSION}</span>
          <p className="m-0 text-sm text-gray-1000">An instrument workbench for Digilent Analog Discovery devices.</p>
          <span className="text-[13px] leading-5 text-gray-900">© 2026 Finn Sheng</span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 border-t border-gray-alpha-400 pt-4 text-sm">
          {[
            ['Electron', electron, true],
            ['Chromium', chrome, true],
            ['Platform', platform, false],
            ['WaveForms SDK', 'Digilent, bundled', false]
          ].map(([k, v, mono]) => (
            <div key={k as string} className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-gray-900">{k}</dt>
              <dd className={cn('m-0', mono ? 'font-mono text-[13px]' : 'text-sm')}>{v}</dd>
            </div>
          ))}
        </dl>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset All Settings?"
        description="Appearance, plots, region, startup and update settings return to their defaults. Workspaces and calibration are kept."
        actions={
          <>
            <Button size="small" type="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              type="error"
              onClick={() => {
                const before = { ...usePrefs.getState() }
                const theme = app.theme
                p.reset()
                app.setTheme('system')
                setConfirmReset(false)
                app.toast('Settings reset to defaults', {
                  action: {
                    label: 'Undo',
                    run: () => {
                      const { set: _s, reset: _r, ...prev } = before
                      usePrefs.getState().set(prev)
                      useStore.getState().setTheme(theme)
                    }
                  }
                })
              }}
            >
              Reset Settings
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13px] text-gray-900">You can undo this from the notification that follows.</p>
      </Modal>
    </>
  )
}
