import fs from 'fs/promises'
import type { ThreadSession } from '../types'

const sessions = new Map<string, ThreadSession>()

const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

export function setSession(threadTs: string, session: ThreadSession): void {
  sessions.set(threadTs, session)
}

export function getSession(threadTs: string): ThreadSession | undefined {
  return sessions.get(threadTs)
}

export function updateSession(threadTs: string, update: Partial<ThreadSession>): void {
  const existing = sessions.get(threadTs)
  if (existing) sessions.set(threadTs, { ...existing, ...update })
}

export function deleteSession(threadTs: string): void {
  sessions.delete(threadTs)
}

export async function evictExpiredSessions(): Promise<void> {
  const now = Date.now()
  for (const [threadTs, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(threadTs)
      await fs.unlink(session.localFilePath).catch(() => {})
    }
  }
}
