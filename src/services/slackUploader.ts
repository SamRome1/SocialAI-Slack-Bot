import fs from 'fs/promises'

export async function uploadVideoToSlack(
  token: string,
  filePath: string,
  filename: string,
  initialComment: string,
  channelId: string,
  threadTs: string,
): Promise<void> {
  const fileBuffer = await fs.readFile(filePath)

  const urlRes = await fetch(
    `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${fileBuffer.byteLength}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const urlJson = await urlRes.json() as any
  if (!urlJson.ok) throw new Error(`files.getUploadURLExternal failed for ${filename}: ${urlJson.error}`)

  const { upload_url, file_id } = urlJson

  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: fileBuffer,
  })
  if (!uploadRes.ok) throw new Error(`Upload POST failed for ${filename}: ${uploadRes.status}`)

  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [{ id: file_id }],
      channel_id: channelId,
      initial_comment: initialComment,
      thread_ts: threadTs,
    }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completeJson = await completeRes.json() as any
  if (!completeJson.ok) throw new Error(`files.completeUploadExternal failed for ${filename}: ${completeJson.error}`)
}
