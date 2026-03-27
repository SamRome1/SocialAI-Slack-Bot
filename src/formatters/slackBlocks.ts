import type { KnownBlock } from '@slack/bolt'
import type { MediaAnalysis, Platform } from '../types'
import { PLATFORM_LABELS } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}K`
  return String(n)
}

function scoreEmoji(score: number): string {
  if (score >= 70) return ':large_green_circle:'
  if (score >= 45) return ':large_yellow_circle:'
  return ':red_circle:'
}

// ── Platform picker blocks ────────────────────────────────────────────────────

export function buildPlatformPickerBlocks(
  fileId: string,
  channelId: string,
  threadTs: string,
): KnownBlock[] {
  const value = (platform: string) => `${fileId}|${channelId}|${threadTs}|${platform}`

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*What platform is this content for?*' },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Instagram' },      action_id: 'platform_select:instagram',    value: value('instagram') },
        { type: 'button', text: { type: 'plain_text', text: 'TikTok' },         action_id: 'platform_select:tiktok',       value: value('tiktok') },
        { type: 'button', text: { type: 'plain_text', text: 'LinkedIn' },        action_id: 'platform_select:linkedin',     value: value('linkedin') },
        { type: 'button', text: { type: 'plain_text', text: 'YouTube Short' },   action_id: 'platform_select:youtube',      value: value('youtube') },
        { type: 'button', text: { type: 'plain_text', text: 'YouTube Long' },    action_id: 'platform_select:youtube_long', value: value('youtube_long') },
        { type: 'button', text: { type: 'plain_text', text: 'Twitter/X' },       action_id: 'platform_select:twitter',      value: value('twitter') },
      ],
    },
  ]
}

// ── Analyzing indicator ───────────────────────────────────────────────────────

export function buildAnalyzingBlocks(platform: Platform, format: string): KnownBlock[] {
  const label = PLATFORM_LABELS[platform]
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:hourglass_flowing_sand: Analyzing for *${label} ${format}*...`,
      },
    },
  ]
}

// ── Full analysis result blocks ───────────────────────────────────────────────

export function buildAnalysisBlocks(
  analysis: MediaAnalysis,
  platform: Platform,
  format: string,
): KnownBlock[] {
  const label = PLATFORM_LABELS[platform]
  const blocks: object[] = []

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `Content Analysis — ${label} ${format}` },
  })

  // Content type badge
  if (analysis.content_type) {
    const label_display = analysis.content_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Detected content type: *${label_display}*` }],
    })
  }

  // Scores row 1: Overall + Hook
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Overall Score*\n${scoreEmoji(analysis.overall_score)} *${analysis.overall_score}/100*` },
      { type: 'mrkdwn', text: `*Hook Strength*\n${scoreEmoji(analysis.hook_strength)} *${analysis.hook_strength}/100*` },
    ],
  })

  // Scores row 2: Visual + Platform fit
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Visual Quality*\n${scoreEmoji(analysis.visual_quality)} *${analysis.visual_quality}/100*` },
      { type: 'mrkdwn', text: `*Platform Fit*\n${scoreEmoji(analysis.platform_fit)} *${analysis.platform_fit}/100*` },
    ],
  })

  // Predicted performance
  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Predicted Views*\n${fmt(analysis.predicted_views_low)} – ${fmt(analysis.predicted_views_high)}` },
      { type: 'mrkdwn', text: `*Predicted Engagement*\n${analysis.predicted_engagement_low.toFixed(1)}% – ${analysis.predicted_engagement_high.toFixed(1)}%` },
    ],
  })

  blocks.push({ type: 'divider' })

  // Summary
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*AI Assessment*\n${analysis.summary}` },
  })

  blocks.push({ type: 'divider' })

  // Strengths
  if (analysis.strengths.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*:white_check_mark: What's Working*\n${analysis.strengths.map((s) => `• ${s}`).join('\n')}`,
      },
    })
  }

  // Improvements
  if (analysis.improvements.length > 0) {
    const lines = analysis.improvements.map((i) => `>*${i.issue}*\n>→ ${i.fix}`).join('\n\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*:arrow_up: Improvements*\n${lines}` },
    })
  }

  // Reframe ideas
  if (analysis.reframe_suggestions.length > 0) {
    blocks.push({ type: 'divider' })
    const lines = analysis.reframe_suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*:bulb: Reframe Ideas*\n${lines}` },
    })
  }

  // Caption suggestions
  if (analysis.caption_suggestions.length > 0) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*:pencil: Caption Suggestions*' },
    })
    analysis.caption_suggestions.forEach((caption, i) => {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `\`Caption ${i + 1}\`\n${caption}` },
      })
    })
  }

  // Inspiration alignment
  if (analysis.inspiration_alignment && analysis.inspiration_alignment.length > 0) {
    blocks.push({ type: 'divider' })
    const lines = analysis.inspiration_alignment.map((s, i) => `${i + 1}. ${s}`).join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*:star: Inspiration Alignment*\n${lines}` },
    })
  }

  // Footer
  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Analyzed with Claude claude-sonnet-4-6 · SocialAI' }],
  })

  return blocks as KnownBlock[]
}
