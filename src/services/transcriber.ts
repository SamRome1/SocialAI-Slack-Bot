import OpenAI from 'openai'
import ffmpeg from 'fluent-ffmpeg'
import { createReadStream } from 'fs'
import { rm, stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

// Whisper's hard file size limit
const WHISPER_MAX_BYTES = 24 * 1024 * 1024 // 24MB (leaving 1MB headroom under the 25MB limit)

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err)
      resolve(metadata.format.duration ?? 0)
    })
  })
}

/**
 * Extracts audio from a video file as a small mono mp3.
 * Caps duration to stay under Whisper's 25MB limit:
 * at 32kbps mono, 24MB ≈ 100 minutes — enough for any realistic video.
 */
async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  const duration = await getVideoDuration(videoPath)
  // 32kbps = 4000 bytes/sec → max seconds before hitting 24MB
  const maxSeconds = Math.floor(WHISPER_MAX_BYTES / 4000)
  const capDuration = duration > maxSeconds ? maxSeconds : undefined

  return new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .format('mp3')
      .on('error', (err) => reject(err))
      .on('end', () => resolve())

    if (capDuration) cmd.duration(capDuration)

    cmd.save(audioPath)
  })
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptResult {
  text: string
  segments: TranscriptSegment[]
}

/**
 * Transcribes a video file using OpenAI Whisper.
 * Returns timestamped segments so callers can identify precise cut points.
 * Returns null if OPENAI_API_KEY is not set or transcription fails.
 */
export async function transcribeVideo(videoPath: string): Promise<TranscriptResult | null> {
  const client = getClient()
  if (!client) return null

  const audioPath = path.join(os.tmpdir(), `socialai-audio-${randomUUID()}.mp3`)

  try {
    await extractAudio(videoPath, audioPath)

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: createReadStream(audioPath),
      response_format: 'verbose_json',
    })

    // verbose_json returns an object with segments array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = response as unknown as any
    const segments: TranscriptSegment[] = (result.segments ?? []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }))
    const text = segments.map((s) => s.text).join(' ').trim()

    return text.length > 0 ? { text, segments } : null
  } catch (err) {
    // Non-fatal — analysis continues with frames only
    console.warn('[transcriber] transcription failed, continuing without transcript:', err)
    return null
  } finally {
    await rm(audioPath, { force: true })
  }
}
