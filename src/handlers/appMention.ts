import type { App } from '@slack/bolt'
import fs from 'fs/promises'
import { downloadSlackFile } from '../services/slackFiles'
import { extractFrames } from '../services/frameExtractor'
import { transcribeVideo, type TranscriptResult } from '../services/transcriber'
import { analyzeMedia, getThoughtBlocks, getEditInstructions } from '../services/claude'
import { createVariant } from '../services/videoEditor'
import { getAnalysisContext } from '../services/socialManager'
import { uploadVideoToSlack } from '../services/slackUploader'
import { setSession, getSession } from '../services/sessionStore'
import { generateThumbnailAndTitleIdeas } from '../services/claude'
import { buildPlatformPickerBlocks, buildAnalyzingBlocks, buildAnalysisBlocks, buildThoughtBlockMapBlocks, buildThumbnailIdeasBlocks } from '../formatters/slackBlocks'
import { youtubeTopVideos } from '../data/youtubeTopVideos'
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

  const brand: BrandContext = {
    brand_name: process.env.BRAND_NAME ?? 'My Brand',
    niche: process.env.BRAND_NICHE ?? 'content creation',
    tone: process.env.BRAND_TONE ?? 'professional',
  }

  // Use static YouTube benchmarks for YouTube platforms
  const isYoutube = platform === 'youtube' || platform === 'youtube_long'
  const staticTopPosts = isYoutube ? youtubeTopVideos.filter((v) => v.content.trim().length > 0) : []

  return { brand, topPosts: staticTopPosts }
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
    let sessionWritten = false

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
        blocks: buildAnalysisBlocks(analysis, platform, format, { channelId, threadTs }),
      })

      if (isLongForm && isVideo && thoughtBlocks && thoughtBlocks.length > 0) {
        // Longform: show content structure, save session for follow-up + thumbnail button
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Content structure:',
          blocks: buildThoughtBlockMapBlocks(thoughtBlocks),
        })

        setSession(threadTs, {
          threadTs,
          channelId,
          platform,
          analysis,
          thoughtBlocks,
          editInstructions: null,
          localFilePath: filePath,
          conversationHistory: [],
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        })
        sessionWritten = true

        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: '_Reply here to ask how a change would affect the score._',
        })

      } else if (!isLongForm && isVideo && editInstructions && thoughtBlocks) {
        // Short-form: produce and upload the 3 variants
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

        // Encode → upload → delete sequentially: three parallel libx264 encodes at
        // preset=fast exceed the 954 MB cgroup limit (each needs ~300 MB for lookahead buffers)
        const token = process.env.SLACK_BOT_TOKEN!
        const variants = [
          { segs: toSegments(editInstructions.hook_b.block_sequence), label: 'hook-b', caption: `*Hook B* — ${editInstructions.hook_b.reason}` },
          { segs: toSegments(editInstructions.hook_c.block_sequence), label: 'hook-c', caption: `*Hook C* — ${editInstructions.hook_c.reason}` },
          { segs: toSegments(editInstructions.tight_cut.block_sequence), label: 'tight-cut', caption: `*Tight Cut* — Original order, slow parts removed` },
        ]
        for (const v of variants) {
          const variantPath = await createVariant(filePath, v.segs, v.label)
          try {
            await uploadVideoToSlack(token, variantPath, `${v.label}.mp4`, v.caption, channelId, threadTs)
          } finally {
            await fs.unlink(variantPath).catch(() => {})
          }
        }

        setSession(threadTs, {
          threadTs,
          channelId,
          platform,
          analysis,
          thoughtBlocks,
          editInstructions,
          localFilePath: filePath,
          conversationHistory: [],
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        })
        sessionWritten = true

        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: '_Reply here to request a custom edit or ask how a change would affect the score._',
        })
      }
    } finally {
      // Only clean up the original file if no session holds a reference to it
      if (!sessionWritten) await cleanup()
    }
  } catch (err) {
    logger.error('runAnalysis error:', err)
    const raw = err instanceof Error ? err.message : ''
    const userMessage = raw.toLowerCase().includes('json') || raw.toLowerCase().includes('timed out')
      ? 'Analysis failed — the video may be too long or complex. Try a shorter clip.'
      : raw || 'Analysis failed. Please try again with a supported video or image.'
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

export function registerThumbnailActionHandler(app: import('@slack/bolt').App) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action('generate_thumbnails', async ({ ack, action, client, logger }: any) => {
    await ack()

    const [channelId, threadTs] = (action.value as string).split('|')

    const session = getSession(threadTs)
    if (!session) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':x: Session expired — please re-upload the video to start a new analysis.',
      })
      return
    }

    let thinkingTs: string | undefined
    try {
      const res = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':hourglass_flowing_sand: Generating thumbnail and title ideas...',
      })
      thinkingTs = res.ts
    } catch { /* non-fatal */ }

    try {
      const ideas = await generateThumbnailAndTitleIdeas(session.analysis, session.thoughtBlocks)
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Thumbnail & title ideas:',
        blocks: buildThumbnailIdeasBlocks(ideas),
      })
    } catch (err) {
      logger.error('generate_thumbnails error:', err)
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':x: Failed to generate ideas. Please try again.',
      })
    } finally {
      if (thinkingTs) {
        await client.chat.delete({ channel: channelId, ts: thinkingTs }).catch(() => {})
      }
    }
  })
}

