import Anthropic from '@anthropic-ai/sdk'
import type { MediaAnalysis, BrandContext } from '../types'
import type { TopPost } from './socialManager'

const MODEL = 'claude-sonnet-4-6'

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

function buildShortFormPrompt(
  frames: number,
  mediaType: 'image' | 'video',
  platform: string,
  format: string,
  brand: BrandContext,
  topPosts: TopPost[],
  inspirationAccounts: string[],
): string {
  const frameNote = mediaType === 'video'
    ? `You are seeing ${frames} frames extracted from a video (covering opening, early hook, mid sections, and near-end). Evaluate as a short-form video post.`
    : 'You are analyzing a single image/photo.'

  const benchmarkNote = topPosts.length > 0
    ? `Top ${topPosts.length} performing posts on ${platform} (benchmarks for scoring and predictions):\n${topPosts.map((p, i) => `${i + 1}. Format: ${p.format} | Score: ${p.score ?? 'N/A'} | Reach: ${p.reach.toLocaleString()} | Hook: "${p.content.slice(0, 120)}"`).join('\n')}`
    : `No historical data available — use general ${platform} platform benchmarks for this niche.`

  const inspirationNote = inspirationAccounts.length > 0
    ? `Accounts this brand wants to emulate: ${inspirationAccounts.join(', ')}`
    : ''

  const inspirationField = inspirationAccounts.length > 0
    ? `  "inspiration_alignment": [
    "<specific insight on how this content aligns with or diverges from what ${inspirationAccounts.join('/')} typically does>",
    "<concrete element from those accounts' playbook to incorporate into this piece>",
    "<specific style, format, or hook technique from those accounts that would elevate this content>"
  ],`
    : ''

  return `You are a brutally honest social media content performance analyst for expert creators.

Brand: "${brand.brand_name}" | Niche: ${brand.niche} | Tone: ${brand.tone}
Platform: ${platform} | Format: ${format}
${frameNote}
${inspirationNote ? `\n${inspirationNote}\n` : ''}
${benchmarkNote}

Scoring rubric — be ruthless, a 70+ means genuinely strong content:
- overall_score: Holistic performance prediction. Weight hook (40%), visual quality (30%), platform fit (30%).
- hook_strength: First 1-3 seconds for video (opening frame energy, pattern interrupts, curiosity gaps). For images: thumb-stopping power, contrast, faces, motion implied.
- visual_quality: Lighting, framing, composition, color grading, text overlays, production value, audio clarity implied by visual cues.
- platform_fit: Algorithm alignment — aspect ratio, pacing cues, trending formats, native platform behaviors (e.g. Reels need vertical, TikTok rewards raw authenticity, LinkedIn prefers talking-head + subtitles).

Analyze this content and return ONLY valid JSON:
{
  "overall_score": <0-100>,
  "hook_strength": <0-100>,
  "visual_quality": <0-100>,
  "platform_fit": <0-100>,
  "predicted_views_low": <conservative view estimate>,
  "predicted_views_high": <optimistic view estimate>,
  "predicted_engagement_low": <decimal % e.g. 3.2>,
  "predicted_engagement_high": <decimal % e.g. 6.8>,
  "summary": "<2-3 sentences: what this content does well, what the single biggest weakness is, and the one change that would have the biggest impact on performance>",
  "strengths": [
    "<specific, evidence-based strength with reference to what you see>",
    "<specific strength>",
    "<specific strength>"
  ],
  "improvements": [
    { "issue": "<specific, named problem>", "fix": "<concrete, step-by-step actionable solution — not vague>"},
    { "issue": "<specific problem>", "fix": "<concrete solution>" },
    { "issue": "<specific problem>", "fix": "<concrete solution>" }
  ],
  "reframe_suggestions": [
    "<alternative hook or angle — write the actual opening line/visual concept>",
    "<alternative hook — different emotional trigger or format>",
    "<alternative angle — different narrative structure>"
  ],
  "caption_suggestions": [
    "<ready-to-use caption: punchy hook line + 2-3 body sentences + CTA + 5-8 relevant hashtags>",
    "<ready-to-use caption: different style/emotional angle + CTA + 5-8 relevant hashtags>"
  ]${inspirationField ? `,\n  ${inspirationField}` : ''}
}

Reference the actual visual content you see. Be specific, not generic.`
}

function buildLongFormPrompt(
  frames: number,
  platform: string,
  brand: BrandContext,
  topPosts: TopPost[],
  inspirationAccounts: string[],
): string {
  const benchmarkNote = topPosts.length > 0
    ? `Top ${topPosts.length} performing long-form posts on ${platform}:\n${topPosts.map((p, i) => `${i + 1}. Format: ${p.format} | Score: ${p.score ?? 'N/A'} | Reach: ${p.reach.toLocaleString()} | Hook: "${p.content.slice(0, 120)}"`).join('\n')}`
    : `No historical data available — use general ${platform} long-form benchmarks for this niche.`

  const inspirationNote = inspirationAccounts.length > 0
    ? `Accounts this brand wants to emulate: ${inspirationAccounts.join(', ')}`
    : ''

  const inspirationField = inspirationAccounts.length > 0
    ? `  "inspiration_alignment": [
    "<specific insight on how this content aligns with or diverges from what ${inspirationAccounts.join('/')} typically does>",
    "<concrete element from those accounts' long-form playbook to incorporate>",
    "<specific structure, pacing, or storytelling technique from those accounts that would elevate this video>"
  ],`
    : ''

  return `You are a brutally honest YouTube long-form content strategist and performance analyst.

Brand: "${brand.brand_name}" | Niche: ${brand.niche} | Tone: ${brand.tone}
Platform: YouTube | Format: Long-form Video

You are seeing ${frames} frames sampled across the full length of the video — covering the intro, early hook window, body sections, and outro. Use these to assess the full viewing experience and retention potential.
${inspirationNote ? `\n${inspirationNote}\n` : ''}
${benchmarkNote}

Scoring rubric for long-form YouTube:
- overall_score: Holistic channel-growth potential. Weight retention potential (35%), hook (30%), visual quality (20%), platform fit (15%).
- hook_strength: First 30 seconds — does the opening establish a clear promise, create a curiosity gap, and give a reason to stay? Rate 0-100.
- visual_quality: Production value across the full video — lighting, b-roll quality, text/graphics, pacing between cuts, color consistency.
- platform_fit: YouTube algorithm fit — does it have strong CTR signals (thumbnail implied), clear chapter structure, good retention cues (pattern interrupts, recaps), and a compelling end screen/CTA?

Analyze this content and return ONLY valid JSON:
{
  "overall_score": <0-100>,
  "hook_strength": <0-100>,
  "visual_quality": <0-100>,
  "platform_fit": <0-100>,
  "predicted_views_low": <conservative view estimate>,
  "predicted_views_high": <optimistic view estimate>,
  "predicted_engagement_low": <decimal % e.g. 3.2>,
  "predicted_engagement_high": <decimal % e.g. 6.8>,
  "summary": "<2-3 sentences: what this video does well, what its biggest retention/growth risk is, and the single most impactful change>",
  "strengths": [
    "<specific, evidence-based strength — reference what you see in the frames>",
    "<specific strength>",
    "<specific strength>"
  ],
  "improvements": [
    { "issue": "<specific problem — name the exact issue e.g. 'No pattern interrupt in first 60s'>", "fix": "<concrete, actionable fix — e.g. 'Cut to a B-roll montage at the 45s mark to reset attention'>" },
    { "issue": "<specific problem>", "fix": "<concrete fix>" },
    { "issue": "<specific problem>", "fix": "<concrete fix>" }
  ],
  "reframe_suggestions": [
    "<alternative title/thumbnail concept that would dramatically improve CTR — write the actual title>",
    "<alternative intro structure — describe the first 30 seconds in detail>",
    "<alternative narrative arc or chapter structure that would improve retention>"
  ],
  "caption_suggestions": [
    "<YouTube description: compelling first 2 lines (show in search) + key timestamps listed + CTA to subscribe + 5-8 SEO hashtags>",
    "<Alternative YouTube description: different angle + timestamps + CTA + hashtags>"
  ]${inspirationField ? `,\n  ${inspirationField}` : ''}
}

Reference the actual frames you see. Be specific and actionable, not generic.`
}

export async function analyzeMedia(
  frames: string[],
  mediaType: 'image' | 'video',
  platform: string,
  format: string,
  brand: BrandContext,
  topPosts: TopPost[] = [],
  inspirationAccounts: string[] = [],
): Promise<MediaAnalysis> {
  const client = getClient()
  const isLongForm = platform === 'youtube_long'

  const prompt = isLongForm
    ? buildLongFormPrompt(frames.length, platform, brand, topPosts, inspirationAccounts)
    : buildShortFormPrompt(frames.length, mediaType, platform, format, brand, topPosts, inspirationAccounts)

  const imageBlocks: Anthropic.ImageBlockParam[] = frames.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }))

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        { type: 'text', text: prompt },
      ],
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return valid JSON')
  return JSON.parse(jsonMatch[0]) as MediaAnalysis
}
