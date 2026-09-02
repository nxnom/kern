import type { Attempt, PairState } from './state'

/**
 * Per-font session storage.
 *
 * Only facts are written: values, attempts and timestamps. Nothing
 * interpretive — no "finished" flag, no summary — because a stored claim rots
 * the moment a run is interrupted, while a measurement can always be redone
 * against the font that is actually loaded.
 */
const VERSION = 'v1'
const PREFIX = `kern:${VERSION}:`
/** Sessions older than this are not worth restoring into. */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30

export interface StoredPair {
  kern: number
  original: number
  attempts: Attempt[]
  touchedAt?: number
  /**
   * Kept across reloads, or a resumed run cannot tell a pair it decided from
   * one it never reached. Leaving it out made the progress line report 43
   * changed pairs and 0 reviewed, and print "-43 left as they were".
   */
  reviewedAt?: number
}

export interface StoredSession {
  version: string
  fontKey: string
  familyName: string
  savedAt: number
  /** How much of the face was being worked through. */
  scope?: string
  /** When a specimen was last published, which is how a run usually ends. */
  specimenAt?: number
  specimen?: string
  pairs: Record<string, StoredPair>
}

/**
 * Identify a font by its bytes.
 *
 * Family name and units-per-em are not enough: two weights of one family
 * collide, and a font that has already been kerned collides with the original
 * it came from.
 */
export async function fontKey(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      return [...new Uint8Array(digest).slice(0, 8)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } catch {
      // Fall through to the synchronous hash below.
    }
  }
  // `crypto.subtle` only exists in a secure context, so a page served over
  // plain http — a phone pointed at a LAN address, say — needs a fallback.
  return fnv1a(new Uint8Array(buffer))
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  // Sampling keeps this fast on a megabyte of font without weakening it much
  // for use as a cache key.
  const step = Math.max(1, Math.floor(bytes.length / 65536))
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `f${h.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`
}

export function loadSession(key: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const session = JSON.parse(raw) as StoredSession
    if (session.version !== VERSION) return null
    if (Date.now() - session.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(PREFIX + session.fontKey, JSON.stringify(session))
  } catch {
    // A full or disabled store must never interrupt the work in progress.
  }
}

export function clearSession(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Nothing to do; the page state is the source of truth either way.
  }
}

export function toStored(pairs: Map<string, PairState>): Record<string, StoredPair> {
  const out: Record<string, StoredPair> = {}
  for (const [key, p] of pairs) {
    // Untouched pairs carry no information worth writing.
    if (p.kern === p.original && p.attempts.length === 0) continue
    out[key] = {
      kern: p.kern,
      original: p.original,
      attempts: p.attempts,
      touchedAt: p.touchedAt,
      reviewedAt: p.reviewedAt,
    }
  }
  return out
}

/**
 * Merge a stored session onto freshly-read pairs.
 *
 * `original` comes from the font, never from storage, so a restore can never
 * misreport what the face actually shipped.
 */
export function restore(
  pairs: Map<string, PairState>,
  stored: Record<string, StoredPair>,
): Map<string, PairState> {
  const next = new Map(pairs)
  for (const [key, saved] of Object.entries(stored)) {
    const current = next.get(key)
    if (!current) continue
    next.set(key, {
      ...current,
      kern: saved.kern,
      attempts: saved.attempts ?? [],
      touchedAt: saved.touchedAt,
      // Sessions written before reviewedAt was stored still carry the evidence:
      // a value that differs from the font's own was decided by someone.
      reviewedAt:
        saved.reviewedAt ?? (saved.kern !== current.original ? saved.touchedAt : undefined),
      status:
        saved.kern !== current.original
          ? 'adjusted'
          : saved.attempts?.some((a) => a.rejected)
            ? 'rejected'
            : 'untouched',
    })
  }
  return next
}

/** Drop every saved session. Used as the last resort after a crash. */
export function clearAllSessions(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch {
    // Nothing to clear, or no storage to clear it from.
  }
}
