import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { execSync } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { VideoSegment } from '../types'

const resolvedFfmpegPath = (() => {
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
    console.log('[videoEditor] using system ffmpeg:', p)
    return p
  } catch {
    console.log('[videoEditor] system ffmpeg not found, falling back to ffmpeg-static:', ffmpegStatic)
    return ffmpegStatic as string
  }
})()

ffmpeg.setFfmpegPath(resolvedFfmpegPath)

// Extract a single segment from inputPath using stream copy (no re-encoding).
// Uses input seeking (-ss before -i) for speed — cuts land on the nearest keyframe.
function extractSegment(inputPath: string, start: number, end: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .inputOptions([`-ss ${start.toFixed(3)}`, `-t ${(end - start).toFixed(3)}`])
      .outputOptions(['-c copy', '-avoid_negative_ts make_zero'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Segment extract (${start.toFixed(2)}-${end.toFixed(2)}s) failed: ${err.message}`)))
      .run()
  })
}

// Join segment files using the concat demuxer — no re-encoding, no filter_complex.
async function concatSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = path.join(os.tmpdir(), `socialai-list-${randomUUID()}.txt`)
  await fs.writeFile(listPath, segmentPaths.map(p => `file '${p}'`).join('\n'))

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Concat failed: ${err.message}`)))
        .run()
    })
  } finally {
    await fs.unlink(listPath).catch(() => {})
  }
}

/**
 * Extracts and joins the given segments from inputPath into a new output file.
 * Uses stream copy throughout — no re-encoding, no filter_complex.
 * Returns the output path — caller must delete it when done.
 */
export async function createVariant(
  inputPath: string,
  segments: VideoSegment[],
  label: string,
): Promise<string> {
  if (segments.length === 0) throw new Error(`No segments provided for variant "${label}"`)

  const mem = process.memoryUsage()
  console.log(`[videoEditor] ${label}: ${segments.length} segment(s), rss: ${(mem.rss / 1024 / 1024).toFixed(0)} MB`)
  console.log(`[videoEditor] ${label} segments:`, segments.map(s => `${s.start.toFixed(2)}-${s.end.toFixed(2)}s`))

  const outputPath = path.join(os.tmpdir(), `socialai-${label}-${randomUUID()}.mp4`)

  if (segments.length === 1) {
    await extractSegment(inputPath, segments[0].start, segments[0].end, outputPath)
    return outputPath
  }

  // Extract each segment to a temp file, then concat, then clean up the temp segments
  const segmentPaths: string[] = []
  try {
    for (const [i, seg] of segments.entries()) {
      const segPath = path.join(os.tmpdir(), `socialai-${label}-seg${i}-${randomUUID()}.mp4`)
      await extractSegment(inputPath, seg.start, seg.end, segPath)
      segmentPaths.push(segPath)
    }
    await concatSegments(segmentPaths, outputPath)
  } finally {
    await Promise.allSettled(segmentPaths.map(p => fs.unlink(p)))
  }

  return outputPath
}
