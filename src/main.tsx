import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Installs document.modelContext, deferring to the browser's native
// implementation when Chrome already provides one.
import '@mcp-b/global'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
