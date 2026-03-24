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

  // Extract channelId + threadTs from shares
  const shares = file.shares ?? {}
  const allShares = [
    ...Object.entries(shares.private ?? {}),
    ...Object.entries(shares.public ?? {}),
  ]
  const [channelId, channelShares] = allShares[0] ?? ['', []]
  const threadTs = channelShares[0]?.ts ?? ''

  return { url, mimetype, name, channelId, threadTs }
}

const MAX_FILE_SIZE_BYTES = 75 * 1024 * 1024 // 75 MB

export async function downloadSlackFile(url: string, botToken: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  })
  if (!res.ok) throw new Error(`File download failed: ${res.status}`)

  const contentLength = res.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
    throw new Error('File too large. Maximum size is 75 MB for videos.')
  }

  const arrayBuffer = await res.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error('File too large. Maximum size is 75 MB for videos.')
  }

  return Buffer.from(arrayBuffer)
}
