import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * Without this, any exception during render blanks the page with nothing on
 * screen — no message, no cause, nothing to act on. Someone opening this in an
 * unfamiliar browser with an unfamiliar font would see white and leave.
 *
 * A saved session is the most likely thing to be holding bad state, so the
 * recovery offered is to clear it rather than only to reload.
 */
interface Props {
  children: ReactNode
  /** Clears stored state for the font that was loaded, if any. */
  onReset?: () => void
}

interface State {
  error: Error | null
  stack?: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Kern crashed:', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? undefined })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className="app crashed">
        <h1>
          <span className="wordmark-fallback">Kern</span>
        </h1>
        <h2>Something broke while drawing the page.</h2>
        <p>
          The details below are the whole of what went wrong. If it happens
          again on the same font, clearing its saved session usually fixes it —
          a stored value can outlive the code that understood it.
        </p>

        <pre>
          {error.name}: {error.message}
          {stack ? `\n${stack.trim()}` : ''}
        </pre>

        <div className="crashed-actions">
          <button onClick={() => window.location.reload()}>Reload</button>
          <button
            className="danger"
            onClick={() => {
              this.props.onReset?.()
              window.location.reload()
            }}
          >
            Clear saved sessions and reload
          </button>
        </div>
      </div>
    )
  }
}
