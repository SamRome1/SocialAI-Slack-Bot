import { createWriteStream } from 'fs'
import { rm } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

export interface SlackFile {
  buffer: Buffer
  mimetype: string
  name: string
  channelId: string
  threadTs: string
}

export async function getSlackFileInfo(
  fileId: string,
  botToken: string,
): Promise<{ url: string; mimetype: string; name: string; channelId: string; threadTs: string }> {
  const res = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  })
  const json = await res.json() as {
    ok: boolean
    file?: {
      url_private_download?: string
      mimetype?: string
      name?: string
      shares?: {
        private?: Record<string, Array<{ ts: string }>>
        public?: Record<string, Array<{ ts: string }>>
      }
    }
    error?: string
  }

  if (!json.ok || !json.file) {
    throw new Error(`files.info failed: ${json.error ?? 'unknown'}`)
  }

  const file = json.file
  const url = file.url_private_download ?? ''
  const mimetype = file.mimetype ?? 'application/octet-stream'
  const name = file.name ?? 'file'

  const shares = file.shares ?? {}
  const allShares = [
    ...Object.entries(shares.private ?? {}),
    ...Object.entries(shares.public ?? {}),
  ]
  const [channelId, channelShares] = allShares[0] ?? ['', []]
  const threadTs = channelShares[0]?.ts ?? ''

  return { url, mimetype, name, channelId, threadTs }
}

/**
 * Streams the file directly to disk — avoids loading large files into RAM.
 * Returns the temp file path and a cleanup function.
 */
export async function downloadSlackFile(
  url: string,
  botToken: string,
  maxSizeMB = 75,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const maxBytes = maxSizeMB * 1024 * 1024

  const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
  if (!res.ok) throw new Error(`File download failed: ${res.status}`)

  const contentLength = res.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`File too large. Maximum size is ${maxSizeMB} MB for this format.`)
  }

  if (!res.body) throw new Error('No response body from Slack')

  const tmpPath = path.join(os.tmpdir(), `socialai-dl-${randomUUID()}`)
  const writeStream = createWriteStream(tmpPath)

  // Stream response body straight to disk — no memory spike
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(Readable.fromWeb(res.body as any), writeStream)

  return {
    filePath: tmpPath,
    cleanup: async () => { await rm(tmpPath, { force: true }) },
  }
}
