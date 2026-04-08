import 'dotenv/config'
import http from 'http'
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

async function main() {
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
