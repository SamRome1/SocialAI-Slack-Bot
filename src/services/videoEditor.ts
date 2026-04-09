import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobePath from '@ffprobe-installer/ffprobe'
import { execSync } from 'child_process'
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
ffmpeg.setFfprobePath(ffprobePath.path)

/**
 * Concatenates the given segments from inputPath into a new output file.
 * Returns the path to the output file — caller must delete it when done.
 */
export async function createVariant(
  inputPath: string,
  segments: VideoSegment[],
  label: string,
): Promise<string> {
  if (segments.length === 0) throw new Error(`No segments provided for variant "${label}"`)

  const mem = process.memoryUsage()
  console.log(`[videoEditor] ${label} starting — heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)} MB used / ${(mem.heapTotal / 1024 / 1024).toFixed(0)} MB total, rss: ${(mem.rss / 1024 / 1024).toFixed(0)} MB`)
  console.log(`[videoEditor] ${label} segments:`, segments.map(s => `${s.start.toFixed(2)}-${s.end.toFixed(2)}s`))

  const outputPath = path.join(os.tmpdir(), `socialai-${label}-${randomUUID()}.mp4`)

  return new Promise((resolve, reject) => {
    if (segments.length === 1) {
      // Single segment — simple trim, no concat needed
      const seg = segments[0]
      ffmpeg(inputPath)
        .setStartTime(seg.start)
        .setDuration(seg.end - seg.start)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-movflags +faststart',
          '-preset ultrafast',
          '-crf 26',
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`FFmpeg error for "${label}": ${err.message}`)))
        .run()
      return
    }

    // Multiple segments — build filter_complex with trim + concat
    // Short audio fades at each boundary soften any remaining cut harshness
    const FADE_DURATION = 0.08
    const videoFilters: string[] = []
    const audioFilters: string[] = []
    const concatInputs: string[] = []

    // Explicitly split the input streams once per segment count.
    // Without this, FFmpeg fans out [0:v]/[0:a] implicitly which causes SIGKILL
    // on Railway (confirmed via diagnostic test).
    const n = segments.length
    videoFilters.push(`[0:v]split=${n}${Array.from({ length: n }, (_, i) => `[vin${i}]`).join('')}`)
    audioFilters.push(`[0:a]asplit=${n}${Array.from({ length: n }, (_, i) => `[ain${i}]`).join('')}`)

    segments.forEach((seg, i) => {
      const duration = seg.end - seg.start
      const fadeOutStart = Math.max(0, duration - FADE_DURATION)
      videoFilters.push(`[vin${i}]trim=start=${seg.start}:duration=${duration},setpts=PTS-STARTPTS[v${i}]`)
      audioFilters.push(
        `[ain${i}]atrim=start=${seg.start}:duration=${duration},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${FADE_DURATION},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}[a${i}]`,
      )
      concatInputs.push(`[v${i}][a${i}]`)
    })

    const filterComplex = [
      ...videoFilters,
      ...audioFilters,
      `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`,
    ].join(';')

    ffmpeg(inputPath)
      .complexFilter(filterComplex)
      .outputOptions([
        '-map [outv]',
        '-map [outa]',
        '-c:v libx264',
        '-c:a aac',
        '-movflags +faststart',
        '-preset fast',
        '-crf 23',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`FFmpeg error for "${label}": ${err.message}`)))
      .run()
  })
}
