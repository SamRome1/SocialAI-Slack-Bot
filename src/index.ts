import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import { execSync, spawnSync } from 'child_process'
import { createApp } from './bot'

// OpenAI SDK requires `File` as a global for audio uploads — polyfill for Node < 20
if (!globalThis.File) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).File = (require('node:buffer') as typeof import('node:buffer')).File
}

// @slack/socket-mode's finity state machine throws when Slack sends
// "server explicit disconnect" while still in the "connecting" state.
// Catch it here so the built-in reconnect loop can recover without
// crashing the process.
process.on('uncaughtException', (err: Error) => {
  if (err.message?.includes('server explicit disconnect')) {
    console.warn('[socket-mode] caught finity disconnect race — waiting for reconnect:', err.message)
    return
  }
  console.error('Uncaught exception:', err)
  process.exit(1)
})

function logStartupDiagnostics() {
  console.log('=== STARTUP DIAGNOSTICS ===')

  // Node version
  console.log('[diag] Node version:', process.version)

  // Memory limit from cgroup (Linux/Railway)
  try {
    const cgroupLimit = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim()
    const limitMB = parseInt(cgroupLimit) / 1024 / 1024
    console.log('[diag] cgroup memory limit:', limitMB < 99999 ? `${limitMB.toFixed(0)} MB` : 'unlimited')
  } catch {
    try {
      // cgroup v2
      const cgroupMax = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim()
      const limitMB = cgroupMax === 'max' ? 'unlimited' : `${(parseInt(cgroupMax) / 1024 / 1024).toFixed(0)} MB`
      console.log('[diag] cgroup v2 memory limit:', limitMB)
    } catch {
      console.log('[diag] cgroup memory limit: could not read')
    }
  }

  // Available system memory
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
    const total = meminfo.match(/MemTotal:\s+(\d+)/)?.[1]
    const available = meminfo.match(/MemAvailable:\s+(\d+)/)?.[1]
    if (total && available) {
      console.log(`[diag] system memory: ${(parseInt(total) / 1024).toFixed(0)} MB total, ${(parseInt(available) / 1024).toFixed(0)} MB available`)
    }
  } catch {
    console.log('[diag] /proc/meminfo: not available')
  }

  // Which ffmpeg binary is in PATH
  try {
    const ffmpegPath = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
    console.log('[diag] ffmpeg in PATH:', ffmpegPath)

    // Can it actually run?
    const result = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000 })
    if (result.status === 0) {
      const version = result.stdout.split('\n')[0]
      console.log('[diag] ffmpeg -version:', version)
    } else {
      console.log('[diag] ffmpeg -version FAILED — signal:', result.signal, 'status:', result.status)
    }
  } catch {
    console.log('[diag] ffmpeg not found in PATH — will use ffmpeg-static')

    // Test ffmpeg-static binary directly
    try {
      const ffmpegStatic = require('ffmpeg-static') as string
      console.log('[diag] ffmpeg-static path:', ffmpegStatic)
      const result = spawnSync(ffmpegStatic, ['-version'], { encoding: 'utf8', timeout: 5000 })
      if (result.status === 0) {
        const version = result.stdout.split('\n')[0]
        console.log('[diag] ffmpeg-static -version:', version)
      } else {
        console.log('[diag] ffmpeg-static -version FAILED — signal:', result.signal, 'status:', result.status, '← THIS IS THE BUG')
      }
    } catch (e) {
      console.log('[diag] ffmpeg-static test threw:', e)
    }
  }

  // Codec tests — synthetic 1-second 320x240 video, no user input needed
  const ffmpegBin = (() => {
    try { return execSync('which ffmpeg', { encoding: 'utf8' }).trim() } catch { return null }
  })() ?? (require('ffmpeg-static') as string)

  const codecTests = [
    { label: 'libx264 (default)',   args: ['-c:v', 'libx264', '-preset', 'ultrafast'] },
    { label: 'libx264 no-asm',      args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-x264opts', 'no-asm'] },
    { label: 'mpeg4',               args: ['-c:v', 'mpeg4', '-q:v', '5'] },
  ]

  for (const test of codecTests) {
    const outPath = `/tmp/diag-${test.label.replace(/\s+/g, '-')}.mp4`
    const result = spawnSync(ffmpegBin, [
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=duration=1',
      ...test.args,
      '-c:a', 'aac', '-t', '1', '-y', outPath,
    ], { encoding: 'utf8', timeout: 15000 })

    if (result.status === 0) {
      console.log(`[diag] codec test "${test.label}": ✓ OK`)
    } else {
      console.log(`[diag] codec test "${test.label}": ✗ FAILED — signal: ${result.signal}, status: ${result.status}`)
      if (result.stderr) console.log(`[diag]   stderr: ${result.stderr.split('\n').slice(-3).join(' | ')}`)
    }
  }

  console.log('=== END DIAGNOSTICS ===')
}

async function main() {
  logStartupDiagnostics()

  const app = createApp()
  const port = parseInt(process.env.PORT ?? '3000', 10)
  await app.start(port)

  // In Socket Mode, Bolt doesn't bind a port — start a standalone health check server
  if (process.env.SLACK_MODE !== 'http') {
    http.createServer((req, res) => {
      res.writeHead(req.url === '/health' ? 200 : 404)
      res.end(req.url === '/health' ? 'ok' : '')
    }).listen(port)
  }

  const mode = process.env.SLACK_MODE === 'http' ? 'HTTP' : 'Socket Mode'
  console.log(`⚡ SocialAI Slack bot running — ${mode}, port: ${port}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
