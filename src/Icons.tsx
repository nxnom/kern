/**
 * Inline SVG icons.
 *
 * Drawn here rather than pulled from a package: six icons is not worth a
 * dependency, and inlining keeps them themeable through currentColor.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function IconDownload(props: { size?: number }) {
  return (
    <svg {...base} width={props.size ?? 16} height={props.size ?? 16}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

export function IconCopy(props: { size?: number }) {
  return (
    <svg {...base} width={props.size ?? 14} height={props.size ?? 14}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function IconCheck(props: { size?: number }) {
  return (
    <svg {...base} width={props.size ?? 14} height={props.size ?? 14}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function IconChevron({ up = false, size = 16 }: { up?: boolean; size?: number }) {
  return (
    <svg
      {...base}
      width={size}
      height={size}
      style={{ transform: up ? 'rotate(180deg)' : undefined, transition: 'transform .18s' }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** Half-filled circle: the negative-space toggle. */
export function IconContrast(props: { size?: number }) {
  return (
    <svg {...base} width={props.size ?? 16} height={props.size ?? 16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconUpload(props: { size?: number }) {
  return (
    <svg {...base} width={props.size ?? 16} height={props.size ?? 16}>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14" />
    </svg>
  )
}
