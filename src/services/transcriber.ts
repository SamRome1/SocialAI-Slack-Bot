import OpenAI from 'openai'
import ffmpeg from 'fluent-ffmpeg'
import { createReadStream } from 'fs'
import { rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

/**
 * Extracts audio from a video file as a small mono mp3.
 * 32kbps mono is plenty for speech recognition and keeps even a 1-hour
 * video well under Whisper's 25MB file limit.
 */
function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .format('mp3')
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(audioPath)
  })
}

/**
 * Transcribes a video file using OpenAI Whisper.
 * Returns the transcript string, or null if OPENAI_API_KEY is not set
 * or transcription fails.
 */
export async function transcribeVideo(videoPath: string): Promise<string | null> {
  const client = getClient()
  if (!client) return null

  const audioPath = path.join(os.tmpdir(), `socialai-audio-${randomUUID()}.mp3`)

  try {
    await extractAudio(videoPath, audioPath)

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: createReadStream(audioPath),
      response_format: 'text',
    })

    const transcript = (response as unknown as string).trim()
    return transcript.length > 0 ? transcript : null
  } catch (err) {
    // Non-fatal — analysis continues with frames only
    console.warn('[transcriber] transcription failed, continuing without transcript:', err)
    return null
  } finally {
    await rm(audioPath, { force: true })
  }
}
