import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from '@ffprobe-installer/ffprobe'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { VideoSegment } from '../types'

ffmpeg.setFfmpegPath(ffmpegPath as string)
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
          '-preset fast',
          '-crf 23',
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`FFmpeg error for "${label}": ${err.message}`)))
        .run()
      return
    }

    // Multiple segments — build filter_complex with trim + concat
    const videoFilters: string[] = []
    const audioFilters: string[] = []
    const concatInputs: string[] = []

    segments.forEach((seg, i) => {
      const duration = seg.end - seg.start
      videoFilters.push(`[0:v]trim=start=${seg.start}:duration=${duration},setpts=PTS-STARTPTS[v${i}]`)
      audioFilters.push(`[0:a]atrim=start=${seg.start}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`)
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
