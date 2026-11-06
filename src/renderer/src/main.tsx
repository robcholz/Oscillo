import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@robcholz/geist/focus-modality'
import './styles/app.css'
import './theme'
import { App } from './shell/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
