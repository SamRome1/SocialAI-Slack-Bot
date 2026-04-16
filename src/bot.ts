import { App, LogLevel } from '@slack/bolt'
import { registerAppMentionHandler, registerPlatformActionHandler } from './handlers/appMention'
import { registerThreadMessageHandler } from './handlers/threadMessage'

export function createApp(): App {
  const isSocketMode = process.env.SLACK_MODE !== 'http'

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    ...(isSocketMode
      ? { socketMode: true, appToken: process.env.SLACK_APP_TOKEN }
      : {}),
    logLevel: LogLevel.INFO,
  })

  registerAppMentionHandler(app)
  registerPlatformActionHandler(app)
  registerThreadMessageHandler(app)

  // Health check for Railway
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receiver = (app as any).receiver
  if (receiver?.router) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    receiver.router.get('/health', (_: any, res: any) => res.send('ok'))
  }

  return app
}
