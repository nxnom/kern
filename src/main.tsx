import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
