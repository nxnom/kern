import { useState } from 'react'
import { IconCheck, IconCopy } from './Icons'

/** The prompt that routes to the tools, with copy sitting inside the text. */
export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`copy-prompt ${copied ? 'copied' : ''}`}
      title="Copy prompt"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      <span>{text}</span>
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  )
}
