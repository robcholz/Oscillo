// Settings (board: Settings). Section nav on the left that follows the scroll; each section is a card
// of option rows. Preferences live in usePrefs, theme in the app store.
import { Button, FormModal, Kbd, Material, Modal, Select, Slider, Snippet, Switch, ThemeSwitcher, Toggle, cn } from '@robcholz/geist'
import { BookOpen, Info, MessageSquare, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { OptionRow, PageBar } from '../components/Page'
import { usePrefs } from '../prefs'
import { useStore } from '../store'

const VERSION = '0.1.0'

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

const SHORTCUTS: { a: string; k: string[] }[] = [
  { a: 'Command Menu', k: ['⌘', 'K'] },
  { a: 'Run or Stop All', k: ['Space'] },
  { a: 'Single', k: ['⌘', '↵'] },
  { a: 'Auto Set', k: ['⌘', '⇧', 'A'] },
  { a: 'Run Script', k: ['⌘', 'R'] },
  { a: 'Save Workspace', k: ['⌘', 'S'] },
  { a: 'Toggle Sidebar', k: ['⌘', 'B'] },
  { a: 'Toggle Light and Dark', k: ['⌘', '⇧', 'L'] },
  { a: 'Open Instrument 1 to 6', k: ['⌘', '1–6'] },
  { a: 'Settings', k: ['⌘', ','] }
]

const COMMANDS = [
  { label: 'Open a Workspace', desc: 'Starts with the workspace and its instruments.', cmd: 'oscillo ~/Lab/filter.oscillo' },
  { label: 'Run a Script Headless', desc: 'No window; the exit code is the script result.', cmd: 'oscillo --headless --script measure.ts' },
  { label: 'Pick a Device', desc: 'Opens the first device that matches the serial number.', cmd: 'oscillo --device SN:210415BB1C2D' },
  { label: 'Safe Mode', desc: 'Starts without saved options or the last workspace.', cmd: 'oscillo --safe-mode' }
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
  const [update, setUpdate] = useState<{ state: 'idle' | 'checking' | 'done'; at?: Date }>({ state: 'idle' })
  const [about, setAbout] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

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

  const checkUpdates = (): void => {
    setUpdate({ state: 'checking' })
    setTimeout(() => setUpdate({ state: 'done', at: new Date() }), 1400)
  }
  const updateFooter =
    update.state === 'checking'
      ? 'Checking for updates…'
      : update.state === 'done'
        ? `Oscillo is up to date. Checked at ${update.at!.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : p.autoUpdate
          ? 'Checks once a day in the background.'
          : 'Automatic checks are off.'

  const select = (label: string, value: string, options: readonly string[], on: (v: string) => void) => (
    <div className={W}>
      <Select size="small" aria-label={label} value={value} options={options} onValueChange={on} />
    </div>
  )
  const ua = navigator.userAgent
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '—'

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
              <OptionRow label="Instrument Windows" description="Open instruments as tabs, docked panels or separate windows.">
                {select('Instrument Windows', p.windows, ['Tabs', 'Docking', 'Separate Windows'], (v) => p.set({ windows: v as typeof p.windows }))}
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
              <OptionRow label="Language">
                {select('Language', p.language, ['English', 'Deutsch', 'Español', '中文', '日本語'], (language) => {
                  p.set({ language })
                  if (language !== 'English') app.toast(`${language} applies after a restart`, { detail: 'Instrument names and help switch on the next launch.' })
                })}
              </OptionRow>
              <OptionRow label="Decimal Symbol">{select('Decimal Symbol', p.decimal, ['Locale', 'Point', 'Comma'], (v) => p.set({ decimal: v as typeof p.decimal }))}</OptionRow>
              <OptionRow label="Digit Grouping">{select('Digit Grouping', p.grouping, ['1,000,000', '1 000 000', 'None'], (grouping) => p.set({ grouping }))}</OptionRow>
              <OptionRow label="List Separator" description="Used between values in exported CSV files.">
                {select('List Separator', p.listSep, ['Comma', 'Semicolon', 'Tab'], (listSep) => p.set({ listSep }))}
              </OptionRow>
            </Section>

            <Section id="startup" title="Startup">
              <OptionRow label="On Start" description="Safe Mode starts without saved options.">
                {select('On Start', p.onStart, ['Open Last Workspace', 'Open Welcome', 'Safe Mode'], (onStart) => p.set({ onStart }))}
              </OptionRow>
              <OptionRow label="Associate Workspace Files" description="Open .oscillo files with Oscillo.">
                <Toggle aria-label="Associate Workspace Files" checked={p.associate} onChange={(associate) => p.set({ associate })} />
              </OptionRow>
              <OptionRow label="Allow Multiple Instances" description="Run more than one Oscillo window, each with its own device.">
                <Toggle aria-label="Allow Multiple Instances" checked={p.multiInstance} onChange={(multiInstance) => p.set({ multiInstance })} />
              </OptionRow>
            </Section>

            <Section id="updates" title="Updates">
              <OptionRow label="Check Automatically" description="Look for a new version once a day.">
                <Toggle aria-label="Check Automatically" checked={p.autoUpdate} onChange={(autoUpdate) => p.set({ autoUpdate })} />
              </OptionRow>
              <OptionRow label={`Version ${VERSION}`} description={<span aria-live="polite">{updateFooter}</span>}>
                <Button size="small" type="secondary" prefix={<RefreshCw size={16} />} loading={update.state === 'checking'} onClick={checkUpdates}>
                  {update.state === 'checking' ? 'Checking' : 'Check for Updates'}
                </Button>
              </OptionRow>
            </Section>

            <Section id="shortcuts" title="Keyboard Shortcuts" description="On Windows and Linux, Ctrl replaces ⌘.">
              {SHORTCUTS.map((s) => (
                <div key={s.a} className="flex h-11 items-center justify-between gap-4 [&+&]:shadow-[inset_0_1px_0_var(--gray-alpha-200)]">
                  <span className="text-sm">{s.a}</span>
                  <span className="flex gap-1" aria-label={s.k.join(' ')}>
                    {s.k.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </Section>

            <Section id="cli" title="Command Line" description="Start Oscillo from a terminal or a CI job.">
              {COMMANDS.map((c) => (
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
                <Button size="small" type="secondary" prefix={<BookOpen size={16} />} onClick={() => window.open('https://github.com/robcholz/oscillo#readme', '_blank')}>
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
        description="Goes to the Oscillo issue tracker with your version and platform attached."
        submitLabel="Send"
        fields={[
          { key: 'topic', label: 'Topic', type: 'select', options: ['Something Is Broken', 'Missing Feature', 'Other'] },
          { key: 'summary', label: 'Summary', placeholder: 'Scope trigger misses the first edge', required: true },
          { key: 'email', label: 'Email (Optional)', placeholder: 'you@lab.edu', validate: (v) => (v && !/^\S+@\S+\.\S+$/.test(v) ? 'Enter an email address, or leave it empty' : null) }
        ]}
        onSubmit={(v) => {
          setFeedback(false)
          app.toast('Thanks for the feedback', { detail: v.summary })
        }}
      />

      <Modal
        open={about}
        onClose={() => setAbout(false)}
        title="About Oscillo"
        description="An instrument workbench for Digilent Analog Discovery devices."
        actions={
          <Button size="small" type="secondary" onClick={() => setAbout(false)}>
            Close
          </Button>
        }
      >
        <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ['Version', VERSION],
            ['Electron', electron],
            ['Chromium', chrome],
            ['Platform', window.oscillo?.platform ?? navigator.platform],
            ['License', 'MIT']
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-900">{k}</dt>
              <dd className="m-0 font-mono text-[13px]">{v}</dd>
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
