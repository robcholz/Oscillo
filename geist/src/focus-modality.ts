// Geist shows the focus ring only after keyboard use. Chromium also matches :focus-visible when a
// script moves focus, such as Radix handing focus back to a menu trigger after a mouse pick, so the
// last input is tracked here and the ring styles in app.css key off [data-modality='keyboard'].
const root = document.documentElement
const set = (modality: 'keyboard' | 'pointer') => {
  if (root.dataset.modality !== modality) root.dataset.modality = modality
}
const modifiers = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'])
set('pointer')
addEventListener('keydown', (e) => !modifiers.has(e.key) && set('keyboard'), true)
addEventListener('pointerdown', () => set('pointer'), true)
