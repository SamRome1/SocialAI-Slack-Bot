import 'dotenv/config'
import http from 'http'
import { createApp } from './bot'

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
