import Anthropic from '@anthropic-ai/sdk'
import type { MediaAnalysis, BrandContext, EditInstructions } from '../types'
import type { TopPost } from './socialManager'

const MODEL = 'claude-sonnet-4-6'

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

const CONTENT_TYPE_SCORING: Record<string, string> = {
  humor: 'Weight comedy timing and punchline delivery (40%), relatability/shareability (35%), hook (25%). Do NOT penalize for lack of product context — humor earns shares and follows, not conversions. Judge whether the joke lands.',
  educational: 'Weight information clarity and structure (35%), hook/curiosity gap (35%), visual quality (30%). Judge whether a viewer learns something actionable.',
  product_demo: 'Weight hook (40%), product clarity and wow moment (35%), platform fit (25%). Judge whether the product value is communicated within the first 5 seconds.',
  podcast_clip: 'Weight hook moment selection (40%), subtitle clarity (30%), visual energy and split-screen dynamics (30%). Judge whether this clip has a standalone insight or emotional peak that works out of context.',
  behind_the_scenes: 'Weight authenticity (40%), narrative arc (35%), hook (25%). Judge whether it gives a feeling of exclusive access.',
  thought_leadership: 'Weight hook/provocation (40%), credibility signals (30%), platform fit (30%). Judge whether the opening statement is bold enough to stop a scroll.',
  announcement: 'Weight hook (40%), product/news clarity (35%), excitement/energy (25%). Judge whether the news is clear within 3 seconds.',
}

function buildShortFormPrompt(
  frames: number,
  mediaType: 'image' | 'video',
  platform: string,
  format: string,
  brand: BrandContext,
  topPosts: TopPost[],
  inspirationAccounts: string[],
  transcript: string | null,
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
    "<specific insight on how this content aligns with or diverges from what ${inspirationAccounts.join('/')} typically does — match the content_type you identified>",
    "<concrete element from those accounts' playbook to incorporate into this specific type of content>",
    "<specific style, format, or technique from those accounts that would elevate this content>"
  ],`
    : ''

  const contentTypeList = Object.keys(CONTENT_TYPE_SCORING).join(', ')
  const transcriptNote = transcript
    ? `\nFull audio transcript:\n"""\n${transcript}\n"""\nUse this transcript as the primary source for understanding what is said, the humor, tone, punchlines, and narrative. The frames show the visuals; the transcript tells you everything spoken.`
    : ''

  return `You are a brutally honest social media content performance analyst for expert creators.

Brand: "${brand.brand_name}" | Niche: ${brand.niche} | Tone: ${brand.tone}
Platform: ${platform} | Format: ${format}
${frameNote}
${inspirationNote ? `\n${inspirationNote}\n` : ''}
${transcriptNote}
${benchmarkNote}

STEP 1 — Identify content type before scoring.
Look at the frames and classify this as one of: ${contentTypeList}
This is critical — your scoring criteria, improvements, and suggestions must be appropriate for the actual content type. Do not evaluate a humor video like a product demo. Do not evaluate a podcast clip like an announcement.

STEP 2 — Score using criteria for that content type:
${Object.entries(CONTENT_TYPE_SCORING).map(([type, rule]) => `- ${type}: ${rule}`).join('\n')}

General scoring notes (apply across all types):
- hook_strength: First 1-3 seconds. Does it stop a scroll? Does it establish the content type and promise immediately?
- visual_quality: Lighting, framing, composition, color, text overlays, production value.
- platform_fit: Aspect ratio, pacing, format conventions, algorithm signals for ${platform}.
- Be ruthless — 70+ means genuinely strong content for its type.

Analyze this content and return ONLY valid JSON:
{
  "content_type": "<one of: ${contentTypeList}>",
  "overall_score": <0-100>,
  "hook_strength": <0-100>,
  "visual_quality": <0-100>,
  "platform_fit": <0-100>,
  "predicted_views_low": <conservative view estimate>,
  "predicted_views_high": <optimistic view estimate>,
  "predicted_engagement_low": <decimal % e.g. 3.2>,
  "predicted_engagement_high": <decimal % e.g. 6.8>,
  "summary": "<2-3 sentences evaluated against the content_type you identified: what it does well, its single biggest weakness for that type, and the one change with biggest impact>",
  "strengths": [
    "<specific, evidence-based strength appropriate to the content_type — reference what you see>",
    "<specific strength>",
    "<specific strength>"
  ],
  "improvements": [
    { "issue": "<specific problem relevant to the content_type — not generic>", "fix": "<concrete, actionable fix — not vague>" },
    { "issue": "<specific problem>", "fix": "<concrete fix>" },
    { "issue": "<specific problem>", "fix": "<concrete fix>" }
  ],
  "reframe_suggestions": [
    "<alternative hook or angle appropriate to the content_type — write the actual opening line or visual concept>",
    "<alternative hook — different emotional trigger or format, still matching content_type>",
    "<alternative angle — different narrative structure>"
  ],
  "caption_suggestions": [
    "<ready-to-use caption matching the content_type tone: punchy hook + body + CTA + 5-8 relevant hashtags>",
    "<ready-to-use caption: different style/angle + CTA + 5-8 relevant hashtags>"
  ]${inspirationField ? `,\n  ${inspirationField}` : ''}
}

Reference the actual frames you see. Be specific, not generic. Your improvements and reframe suggestions must match the content_type — do not suggest adding product demos to a humor video.`
}

function buildLongFormPrompt(
  frames: number,
  platform: string,
  brand: BrandContext,
  topPosts: TopPost[],
  inspirationAccounts: string[],
  transcript: string | null,
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

  const transcriptNote = transcript
    ? `\nFull audio transcript:\n"""\n${transcript}\n"""\nUse this as the primary source for understanding the content, narrative structure, chapter flow, key arguments, and delivery. The frames show visuals; the transcript tells you everything spoken.`
    : ''

  return `You are a brutally honest YouTube long-form content strategist and performance analyst.

Brand: "${brand.brand_name}" | Niche: ${brand.niche} | Tone: ${brand.tone}
Platform: YouTube | Format: Long-form Video

You are seeing ${frames} frames sampled across the full length of the video — covering the intro, early hook window, body sections, and outro. Use these to assess the full viewing experience and retention potential.
${inspirationNote ? `\n${inspirationNote}\n` : ''}
${transcriptNote}
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
  transcript: string | null = null,
): Promise<MediaAnalysis> {
  const client = getClient()
  const isLongForm = platform === 'youtube_long'

  const prompt = isLongForm
    ? buildLongFormPrompt(frames.length, platform, brand, topPosts, inspirationAccounts, transcript)
    : buildShortFormPrompt(frames.length, mediaType, platform, format, brand, topPosts, inspirationAccounts, transcript)

  const imageBlocks: Anthropic.ImageBlockParam[] = frames.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }))

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
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

export async function getEditInstructions(
  frames: string[],
  timestamps: number[],
  videoDuration: number,
  platform: string,
  transcript: string | null,
): Promise<EditInstructions> {
  const client = getClient()

  const frameDescriptions = frames.map((_, i) => `Frame ${i + 1} [t=${timestamps[i].toFixed(1)}s]`).join(', ')

  const transcriptNote = transcript
    ? `\nFull audio transcript:\n"""\n${transcript}\n"""\nUse this to understand the spoken narrative, punchlines, key moments, and where energy drops.`
    : ''

  const prompt = `You are a professional video editor optimizing a short-form video for ${platform}.

Video duration: ${videoDuration.toFixed(1)}s
Frames provided: ${frameDescriptions}
${transcriptNote}

You are seeing ${frames.length} frames sampled at the timestamps listed above. Use them to understand the visual arc and energy of the video.

Your job is to produce edit instructions for 3 versions of this video:

VERSION B — "Hook B" (~${Math.round(videoDuration)}s, same total length)
Find the single strongest hook moment in the video (a moment that would stop a scroll if the video started there). Rearrange segments so the video opens at that moment. You may append the pre-hook material after, or drop it if it adds no value. Total duration should stay close to ${Math.round(videoDuration)}s.

VERSION C — "Hook C" (~${Math.round(videoDuration * 0.75)}s, different hook + tighter)
Find a second strong hook moment (different from Version B). Rearrange to start there AND cut any slow/low-value segments throughout. Target: ~${Math.round(videoDuration * 0.75)}s total.

VERSION D — "Tight Cut" (~${Math.round(videoDuration * 0.5)}s, original order)
Keep the original segment order but aggressively remove all slow, repetitive, or low-energy sections. Target: ~${Math.round(videoDuration * 0.5)}s total.

IMPORTANT RULES:
- All timestamps must be between 0 and ${videoDuration.toFixed(1)}
- Segments within each version must not overlap
- Each segment needs a minimum duration of 1.0s
- The segments array defines what gets concatenated in order — first segment plays first
- For hook variants, the pre-hook material (everything before the hook start) can either be appended at the end or dropped — choose based on whether it adds context or is just filler

Return ONLY valid JSON:
{
  "video_duration": ${videoDuration.toFixed(1)},
  "hook_b": {
    "reason": "<one sentence: why this moment is the strongest hook and what timestamp it starts at>",
    "segments": [
      { "start": <number>, "end": <number> }
    ]
  },
  "hook_c": {
    "reason": "<one sentence: why this is a strong alternative hook and what timestamp it starts at>",
    "segments": [
      { "start": <number>, "end": <number> }
    ]
  },
  "tight_cut": {
    "segments": [
      { "start": <number>, "end": <number> }
    ]
  }
}`

  const imageBlocks: Anthropic.ImageBlockParam[] = frames.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }))

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
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
  if (!jsonMatch) throw new Error('Claude did not return edit instructions JSON')
  return JSON.parse(jsonMatch[0]) as EditInstructions
}
