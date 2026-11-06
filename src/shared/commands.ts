// App commands. On macOS the menu bar owns key equivalents (⌘R, ⌘Z, ⌘0 …) before the page sees
// them, so every shortcut is a menu item that sends its command here (src/main/menu.ts), and the
// renderer runs it (src/renderer/src/shell/commands.ts).

export const COMMAND = 'app:command'

export type AppCommand =
  | 'settings'
  | 'search'
  | 'open-workspace'
  | 'save-workspace'
  | 'undo'
  | 'redo'
  | 'toggle-sidebar'
  | 'toggle-panel'
  | 'toggle-theme'
  | 'single'
  | 'auto-set'
  | 'run-script'
  | 'about'
  | 'check-updates'
  | 'feedback'
  | 'shortcuts'
  | 'docs'
  | 'report-issue'
  | `page:${string}`
