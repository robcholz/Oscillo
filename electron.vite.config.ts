import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
      // Geist is linked from ../Geist; resolve its peers from this app so there is one React.
      dedupe: ['react', 'react-dom', 'radix-ui', 'cmdk', 'clsx']
    },
    plugins: [react(), tailwindcss()]
  }
})
