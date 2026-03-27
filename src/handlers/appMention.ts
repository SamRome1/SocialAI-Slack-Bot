import type { App } from '@slack/bolt'
import { downloadSlackFile } from '../services/slackFiles'
import { extractFrames } from '../services/frameExtractor'
import { transcribeVideo } from '../services/transcriber'
import { analyzeMedia } from '../services/claude'
import { getAnalysisContext } from '../services/socialManager'
import { buildPlatformPickerBlocks, buildAnalyzingBlocks, buildAnalysisBlocks } from '../formatters/slackBlocks'
import type { BrandContext, Platform } from '../types'
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

      // Longform YouTube gets a longer timeout (8 min vs 3 min)
      const timeoutMs = isLongForm ? 8 * 60 * 1000 : 3 * 60 * 1000
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

    // Longform YouTube: allow up to 500 MB; all others: 75 MB
    const maxSizeMB = isLongForm ? 500 : 75
    const { filePath, cleanup } = await downloadSlackFile(url, process.env.SLACK_BOT_TOKEN!, maxSizeMB)

    // Longform: 10 frames; short-form: 6 frames
    const maxFrames = isLongForm ? 10 : 6
    let frames: string[]
    let mediaType: 'image' | 'video'
    let transcript: string | null = null
    try {
      const [extractResult, transcriptResult] = await Promise.all([
        extractFrames(filePath, mimetype, maxFrames),
        mimetype.startsWith('video/') ? transcribeVideo(filePath) : Promise.resolve(null),
      ])
      frames = extractResult.frames
      mediaType = extractResult.mediaType
      transcript = transcriptResult
    } finally {
      await cleanup()
    }

    const { brand, topPosts } = await getBrandContext(platform)
    const inspirationAccounts = getInspirationAccounts(platform)
    const analysis = await analyzeMedia(frames, mediaType, platform, format, brand, topPosts, inspirationAccounts, transcript)

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Analysis complete — Overall score: ${analysis.overall_score}/100`,
      blocks: buildAnalysisBlocks(analysis, platform, format),
    })
  } catch (err) {
    logger.error('runAnalysis error:', err)
    // Only surface user-friendly messages, not internal error details
    const userMessage = err instanceof Error && err.message.startsWith('File')
      ? err.message
      : 'Analysis failed. Please try again with a supported video or image.'
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `:x: ${userMessage}`,
    })
  }
}
