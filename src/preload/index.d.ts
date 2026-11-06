import type { OscilloApi } from './index'

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser (tests, screenshots). */
    oscillo?: OscilloApi
  }
}
