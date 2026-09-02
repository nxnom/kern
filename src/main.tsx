import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Installs document.modelContext, deferring to the browser's native
// implementation when Chrome already provides one.
import '@mcp-b/global'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { clearAllSessions } from './kern/storage.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={clearAllSessions}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
