import type { App } from '@slack/bolt'
import fs from 'fs/promises'
import { getSession, updateSession } from '../services/sessionStore'
import { classifyAndRespondToFollowUp } from '../services/claude'
import { createVariant } from '../services/videoEditor'
import { uploadVideoToSlack } from '../services/slackUploader'
import { buildPredictionBlocks, buildNewEditCaptionText } from '../formatters/followUpBlocks'
import type { ConversationTurn, VideoSegment, ThoughtBlock } from '../types'

export function registerThreadMessageHandler(app: App) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.message(async ({ event, client, logger }: any) => {
    const msg = event

    logger.info(`[threadMessage] received — ts:${msg.ts} thread_ts:${msg.thread_ts} bot_id:${msg.bot_id} subtype:${msg.subtype}`)

    // Must be a thread reply (not the root message)
    if (!msg.thread_ts || msg.thread_ts === msg.ts) { logger.info('[threadMessage] skip: not a thread reply'); return }

    // Ignore bot messages
    if (msg.bot_id || msg.subtype === 'bot_message') { logger.info('[threadMessage] skip: bot message'); return }

    // Must have text
    const userText: string = (msg.text ?? '').trim()
    if (!userText) { logger.info('[threadMessage] skip: no text'); return }

    // Ignore app_mention events — the appMention handler covers those
    const botUserId = process.env.SLACK_BOT_USER_ID
    if (botUserId && userText.includes(`<@${botUserId}>`)) { logger.info('[threadMessage] skip: app_mention'); return }

    // Must have an active session for this thread
    const session = getSession(msg.thread_ts)
    if (!session) { logger.info(`[threadMessage] skip: no session for thread_ts ${msg.thread_ts}`); return }

    const channelId: string = msg.channel
    const threadTs: string = msg.thread_ts
    const token = process.env.SLACK_BOT_TOKEN!

    // Post a thinking indicator and capture its ts so we can delete it after
    let thinkingTs: string | undefined
    try {
      const thinkingRes = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':hourglass_flowing_sand: Thinking...',
      })
      thinkingTs = thinkingRes.ts
    } catch {
      // Non-fatal — continue without indicator
    }

    // Append user turn to history
    const userTurn: ConversationTurn = { role: 'user', content: userText, timestamp: Date.now() }
    const updatedHistory = [...session.conversationHistory, userTurn]
    updateSession(threadTs, { conversationHistory: updatedHistory, lastActivityAt: Date.now() })

    try {
      const intent = await classifyAndRespondToFollowUp(userText, {
        ...session,
        conversationHistory: updatedHistory,
      })

      let assistantReply = ''

      if (intent.type === 'prediction') {
        const blocks = buildPredictionBlocks(
          intent.reasoning,
          intent.estimatedScoreDelta,
          session.analysis.overall_score,
        )
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: intent.reasoning,
          blocks,
        })
        assistantReply = intent.reasoning

      } else if (intent.type === 'new_edit') {
        const validIndices = new Set(session.thoughtBlocks.map((b: ThoughtBlock) => b.index))
        const allValid = intent.blockSequence.length > 0 &&
          intent.blockSequence.every((i: number) => validIndices.has(i))

        if (!allValid) {
          const errText = "I couldn't map those blocks to the video structure. Could you rephrase — e.g. 'use blocks 0, 2, 3 in that order'?"
          await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: errText })
          assistantReply = errText
        } else {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:scissors: Generating *${intent.label}*...`,
          })

          const toSegments = (sequence: number[]): VideoSegment[] =>
            sequence
              .map((i) => session.thoughtBlocks.find((b: ThoughtBlock) => b.index === i))
              .filter((b): b is ThoughtBlock => b !== undefined)
              .map((b) => ({ start: b.start, end: b.end }))

          let variantPath: string | null = null
          try {
            // Check the original file still exists (lost on restart)
            await fs.access(session.localFilePath)

            variantPath = await createVariant(session.localFilePath, toSegments(intent.blockSequence), intent.label)
            const caption = buildNewEditCaptionText(
              intent.label,
              intent.reason,
              intent.blockSequence,
              session.thoughtBlocks,
            )
            await uploadVideoToSlack(token, variantPath, `${intent.label}.mp4`, caption, channelId, threadTs)
            assistantReply = `Generated ${intent.label}: ${intent.reason}`
          } catch (err: unknown) {
            const isNotFound = err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
            const errText = isNotFound
              ? ':x: The original video is no longer available — please re-upload and tag me to start a new session.'
              : ':x: Failed to generate the edit. Please try again.'
            await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: errText })
            assistantReply = errText
            logger.error('new_edit variant error:', err)
          } finally {
            if (variantPath) await fs.unlink(variantPath).catch(() => {})
          }
        }

      } else {
        // clarification
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: intent.response,
        })
        assistantReply = intent.response
      }

      // Append assistant turn to history
      const assistantTurn: ConversationTurn = { role: 'assistant', content: assistantReply, timestamp: Date.now() }
      updateSession(threadTs, {
        conversationHistory: [...updatedHistory, assistantTurn],
        lastActivityAt: Date.now(),
      })

    } catch (err) {
      logger.error('threadMessage error:', err)
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':x: Something went wrong. Please try again.',
      })
    } finally {
      // Delete the thinking indicator
      if (thinkingTs) {
        await client.chat.delete({ channel: channelId, ts: thinkingTs }).catch(() => {})
      }
    }
  })
}
