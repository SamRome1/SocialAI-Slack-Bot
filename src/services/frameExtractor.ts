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
  mediaType: 'image' | 'video'
}

export async function extractFrames(
  buffer: Buffer,
  mimetype: string,
): Promise<ExtractResult> {
  if (mimetype.startsWith('image/')) {
    return extractImage(buffer)
  }
  return extractVideoFrames(buffer)
}

async function extractImage(buffer: Buffer): Promise<ExtractResult> {
  const resized = await sharp(buffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { frames: [resized.toString('base64')], mediaType: 'image' }
}

async function extractVideoFrames(buffer: Buffer): Promise<ExtractResult> {
  const tmpDir = path.join(os.tmpdir(), `socialai-${randomUUID()}`)
  await fs.mkdir(tmpDir)
  const inputPath = path.join(tmpDir, 'input.mp4')

  try {
    await fs.writeFile(inputPath, buffer)

    const duration = await getVideoDuration(inputPath)
    // 0.5s avoids black opening frames; 30% and 70% give middle/end coverage
    const times = [0.5, duration * 0.3, duration * 0.7].filter((t) => t < duration)

    const frames: string[] = []
    for (const time of times) {
      const frameBuffer = await extractFrameAtTime(inputPath, time)
      const resized = await sharp(frameBuffer)
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()
      frames.push(resized.toString('base64'))
    }

    return { frames, mediaType: 'video' }
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
