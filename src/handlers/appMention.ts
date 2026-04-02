import type { App } from '@slack/bolt'
import fs from 'fs/promises'
import { downloadSlackFile } from '../services/slackFiles'
import { extractFrames } from '../services/frameExtractor'
import { transcribeVideo, type TranscriptResult } from '../services/transcriber'
import { analyzeMedia, getThoughtBlocks, getEditInstructions } from '../services/claude'
import { createVariant } from '../services/videoEditor'
import { getAnalysisContext } from '../services/socialManager'
import { buildPlatformPickerBlocks, buildAnalyzingBlocks, buildAnalysisBlocks } from '../formatters/slackBlocks'
import type { BrandContext, Platform, ThoughtBlock, VideoSegment } from '../types'
import { PLATFORM_DEFAULT_FORMAT } from '../types'

const SUPPORTED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
])

interface SlackFile {
  id: string
  name?: string
  mimetype?: string
  url_private_download?: string
}

function getInspirationAccounts(platform: string): string[] {
  // Normalize youtube_long → youtube for env var lookup
  const key = platform === 'youtube_long' ? 'youtube' : platform
  const raw = process.env[`INSPIRATION_ACCOUNTS_${key.toUpperCase()}`]
    ?? process.env.INSPIRATION_ACCOUNTS
    ?? ''
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

async function getBrandContext(platform: string): Promise<{ brand: BrandContext; topPosts: import('../services/socialManager').TopPost[] }> {
  const context = await getAnalysisContext(platform)
  if (context) return { brand: context.brand, topPosts: context.topPosts }
  return {
    brand: {
      brand_name: process.env.BRAND_NAME ?? 'My Brand',
      niche: process.env.BRAND_NICHE ?? 'content creation',
      tone: process.env.BRAND_TONE ?? 'professional',
    },
    topPosts: [],
  }
}

export function registerAppMentionHandler(app: App) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('app_mention', async ({ event, client, logger }: any) => {
    const channel = event.channel as string
    const threadTs = (event.thread_ts ?? event.ts) as string
    const files: SlackFile[] = event.files ?? []

    // Filter to supported file types
    const supported = files.filter((f) => SUPPORTED_TYPES.has(f.mimetype ?? ''))

    if (supported.length === 0) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: 'Please attach a video or image and tag me again. Supported: MP4, MOV, WebM, JPG, PNG, WebP.',
      })
      return
    }

    const file = supported[0]

    // Ask which platform
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: 'What platform is this content for?',
      blocks: buildPlatformPickerBlocks(file.id, channel, threadTs),
    })
  })
}

export function registerPlatformActionHandler(app: App) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action(/^platform_select:/, async ({ ack, action, client, logger, body }: any) => {
    await ack()

    try {
      const parts = (action.value as string).split('|')
      const [fileId, channelId, threadTs, platformStr] = parts
      const platform = platformStr as Platform
      const format = PLATFORM_DEFAULT_FORMAT[platform] ?? 'Video'
      const isLongForm = platform === 'youtube_long'

      const messageTs = body.message?.ts as string | undefined
      if (messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Analyzing for ${format}...`,
          blocks: buildAnalyzingBlocks(platform, format),
        })
      }

      // Longform YouTube: 8 min; short-form: 6 min (extra time for 3x FFmpeg edit passes)
      const timeoutMs = isLongForm ? 8 * 60 * 1000 : 6 * 60 * 1000
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timed out. Try a shorter or smaller video.')), timeoutMs),
      )
      Promise.race([
        runAnalysis(client, fileId, channelId, threadTs, platform, format, logger),
        timeout,
      ]).catch(async (err: unknown) => {
        logger.error('runAnalysis error:', err)
        const msg = err instanceof Error ? err.message : 'Analysis failed. Please try again.'
        await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: `:x: ${msg}` })
      })
    } catch (err) {
      logger.error('platformAction error:', err)
    }
  })
}

async function runAnalysis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  fileId: string,
  channelId: string,
  threadTs: string,
  platform: Platform,
  format: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: any,
) {
  const editedPaths: string[] = []

  try {
    const isLongForm = platform === 'youtube_long'

    // Get file info + download
    const infoRes = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infoJson = await infoRes.json() as any
    if (!infoJson.ok) throw new Error(`files.info failed: ${infoJson.error}`)

    const url: string = infoJson.file.url_private_download
    const mimetype: string = infoJson.file.mimetype ?? 'video/mp4'
    const isVideo = mimetype.startsWith('video/')

    // Longform YouTube: allow up to 500 MB; all others: 75 MB
    const maxSizeMB = isLongForm ? 500 : 75
    const { filePath, cleanup } = await downloadSlackFile(url, process.env.SLACK_BOT_TOKEN!, maxSizeMB)

    // Longform: 10 frames; short-form: 6 frames
    const maxFrames = isLongForm ? 10 : 6
    let frames: string[]
    let timestamps: number[]
    let duration: number
    let mediaType: 'image' | 'video'
    let transcriptResult: TranscriptResult | null = null

    try {
      const [extractResult, transcriptRaw] = await Promise.all([
        extractFrames(filePath, mimetype, maxFrames),
        isVideo ? transcribeVideo(filePath) : Promise.resolve(null),
      ])
      frames = extractResult.frames
      timestamps = extractResult.timestamps
      duration = extractResult.duration
      mediaType = extractResult.mediaType
      transcriptResult = transcriptRaw

      const { brand, topPosts } = await getBrandContext(platform)
      const inspirationAccounts = getInspirationAccounts(platform)

      const transcriptText = transcriptResult?.text ?? null

      // Analysis + thought block grouping run in parallel
      const [analysis, thoughtBlocks] = await Promise.all([
        analyzeMedia(frames, mediaType, platform, format, brand, topPosts, inspirationAccounts, transcriptText),
        isVideo && transcriptResult
          ? getThoughtBlocks(transcriptResult, duration)
          : Promise.resolve(null),
      ])

      // Edit instructions need thought blocks first
      let editInstructions = null
      if (isVideo && thoughtBlocks && thoughtBlocks.length > 0) {
        editInstructions = await getEditInstructions(thoughtBlocks, duration, platform)
      }

      // Post condensed analysis
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Analysis complete — Overall score: ${analysis.overall_score}/100`,
        blocks: buildAnalysisBlocks(analysis, platform, format),
      })

      // If it's a video with edit instructions, produce and upload the 3 variants
      if (isVideo && editInstructions && thoughtBlocks) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Generating 3 edited versions...',
        })

        const toSegments = (sequence: number[]): VideoSegment[] =>
          sequence
            .map((i) => thoughtBlocks.find((b) => b.index === i))
            .filter((b): b is ThoughtBlock => b !== undefined)
            .map((b) => ({ start: b.start, end: b.end }))

        const [hookBPath, hookCPath, tightCutPath] = await Promise.all([
          createVariant(filePath, toSegments(editInstructions.hook_b.block_sequence), 'hook-b'),
          createVariant(filePath, toSegments(editInstructions.hook_c.block_sequence), 'hook-c'),
          createVariant(filePath, toSegments(editInstructions.tight_cut.block_sequence), 'tight-cut'),
        ])
        editedPaths.push(hookBPath, hookCPath, tightCutPath)

        // Upload all 3 files to the thread
        const token = process.env.SLACK_BOT_TOKEN!
        await Promise.all([
          uploadVideoToSlack(token, hookBPath, `hook-b.mp4`, `*Hook B* — ${editInstructions.hook_b.reason}`, channelId, threadTs),
          uploadVideoToSlack(token, hookCPath, `hook-c.mp4`, `*Hook C* — ${editInstructions.hook_c.reason}`, channelId, threadTs),
          uploadVideoToSlack(token, tightCutPath, `tight-cut.mp4`, `*Tight Cut* — Original order, slow parts removed`, channelId, threadTs),
        ])
      }
    } finally {
      await cleanup()
    }
  } catch (err) {
    logger.error('runAnalysis error:', err)
    const userMessage = err instanceof Error
      ? err.message
      : 'Analysis failed. Please try again with a supported video or image.'
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `:x: ${userMessage}`,
    })
  } finally {
    // Clean up edited output files
    await Promise.allSettled(editedPaths.map((p) => fs.unlink(p)))
  }
}

async function uploadVideoToSlack(
  token: string,
  filePath: string,
  filename: string,
  initialComment: string,
  channelId: string,
  threadTs: string,
): Promise<void> {
  const fileBuffer = await fs.readFile(filePath)

  // Step 1 — get an upload URL
  const urlRes = await fetch(
    `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${fileBuffer.byteLength}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const urlJson = await urlRes.json() as any
  if (!urlJson.ok) throw new Error(`files.getUploadURLExternal failed for ${filename}: ${urlJson.error}`)

  const { upload_url, file_id } = urlJson

  // Step 2 — upload the file bytes
  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: fileBuffer,
  })
  if (!uploadRes.ok) throw new Error(`Upload POST failed for ${filename}: ${uploadRes.status}`)

  // Step 3 — complete the upload, posting it to the thread
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
