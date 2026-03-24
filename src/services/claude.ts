import Anthropic from '@anthropic-ai/sdk'
import type { MediaAnalysis, BrandContext } from '../types'
import type { TopPost } from './socialManager'

const MODEL = 'claude-sonnet-4-6'

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

export async function analyzeMedia(
  frames: string[],
  mediaType: 'image' | 'video',
  platform: string,
  format: string,
  brand: BrandContext,
  topPosts: TopPost[] = [],
): Promise<MediaAnalysis> {
  const client = getClient()

  const frameNote = mediaType === 'video'
    ? `You are seeing ${frames.length} frames extracted from a video (opening, middle, end). Evaluate as a video post.`
    : 'You are analyzing a single image/photo.'

  const benchmarkNote = topPosts.length > 0
    ? `Top ${topPosts.length} performing posts on ${platform} (use as benchmarks for scoring and predictions):
${topPosts.map((p, i) => `${i + 1}. Format: ${p.format} | Score: ${p.score ?? 'N/A'} | Reach: ${p.reach.toLocaleString()} | Hook: "${p.content.slice(0, 120)}"`).join('\n')}`
    : `No historical data available — use general ${platform} platform benchmarks for this niche.`

  const prompt = `You are a social media content performance analyst for expert creators.

Brand: "${brand.brand_name}" | Niche: ${brand.niche} | Tone: ${brand.tone}
Platform: ${platform} | Format: ${format}
${frameNote}

${benchmarkNote}

Analyze this content and predict its performance. Return ONLY valid JSON:
{
  "overall_score": <0-100, holistic performance prediction>,
  "hook_strength": <0-100, how compelling the first impression is — for video: opening frame energy; for image: thumb-stopping power>,
  "visual_quality": <0-100, production quality, composition, clarity>,
  "platform_fit": <0-100, how well this matches ${platform} norms and algorithm preferences>,
  "predicted_views_low": <conservative view estimate based on platform benchmarks>,
  "predicted_views_high": <optimistic view estimate>,
  "predicted_engagement_low": <decimal % e.g. 3.2>,
  "predicted_engagement_high": <decimal % e.g. 6.8>,
  "summary": "<2-3 sentences: what this content does well, what holds it back, and the single most impactful change>",
  "strengths": ["<specific strength 1>", "<specific strength 2>", "<specific strength 3>"],
  "improvements": [
    { "issue": "<specific problem>", "fix": "<concrete, actionable solution>" },
    { "issue": "<specific problem>", "fix": "<concrete, actionable solution>" },
    { "issue": "<specific problem>", "fix": "<concrete, actionable solution>" }
  ],
  "reframe_suggestions": [
    "<alternative hook or angle that would perform better>",
    "<alternative hook or angle that would perform better>",
    "<alternative hook or angle that would perform better>"
  ],
  "caption_suggestions": [
    "<ready-to-use caption with hook + body + CTA>",
    "<ready-to-use caption — different style/angle>"
  ]
}

Be specific. Score ruthlessly — a 70+ should mean genuinely strong content.`

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
