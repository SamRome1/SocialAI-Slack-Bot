import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from '@ffprobe-installer/ffprobe'
import sharp from 'sharp'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

// Point fluent-ffmpeg at the bundled binaries
ffmpeg.setFfmpegPath(ffmpegPath as string)
ffmpeg.setFfprobePath(ffprobePath.path)

export interface ExtractResult {
  frames: string[]       // base64 JPEG strings
  timestamps: number[]   // seconds into the video each frame was taken from
  duration: number       // total video duration in seconds (0 for images)
  mediaType: 'image' | 'video'
}

/**
 * Extract frames from a file already on disk.
 * For images: resizes and returns a single frame.
 * For video: extracts maxFrames frames distributed across the video duration.
 */
export async function extractFrames(
  filePath: string,
  mimetype: string,
  maxFrames = 6,
): Promise<ExtractResult> {
  if (mimetype.startsWith('image/')) {
    return extractImage(filePath)
  }
  return extractVideoFrames(filePath, maxFrames)
}

async function extractImage(filePath: string): Promise<ExtractResult> {
  const resized = await sharp(filePath)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { frames: [resized.toString('base64')], timestamps: [0], duration: 0, mediaType: 'image' }
}

async function extractVideoFrames(inputPath: string, maxFrames: number): Promise<ExtractResult> {
  // Use a separate tmpDir only for the extracted frame JPEGs
  const tmpDir = path.join(os.tmpdir(), `socialai-frames-${randomUUID()}`)
  await fs.mkdir(tmpDir)

  try {
    const duration = await getVideoDuration(inputPath)

    // First frame: very early (avoids black frames), last frame: near end.
    // Middle frames distributed evenly so Claude sees the full arc of the video.
    const startTime = Math.min(0.5, duration * 0.02)
    const times: number[] = [startTime]

    for (let i = 1; i < maxFrames - 1; i++) {
      times.push(startTime + (duration * 0.95 - startTime) * (i / (maxFrames - 1)))
    }

    times.push(duration * 0.97)

    const validTimes = times.filter((t) => t < duration)

    const frames: string[] = []
    for (const time of validTimes) {
      const frameBuffer = await extractFrameAtTime(inputPath, time)
      const resized = await sharp(frameBuffer)
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()
      frames.push(resized.toString('base64'))
    }

    return { frames, timestamps: validTimes, duration, mediaType: 'video' }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err)
      resolve(metadata.format.duration ?? 30)
    })
  })
}

function extractFrameAtTime(inputPath: string, timeSeconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = ffmpeg(inputPath)
      .seekInput(timeSeconds)
      .frames(1)
      .format('image2')
      .videoCodec('mjpeg')
      .on('error', reject)
      .pipe()

    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}
