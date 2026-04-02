import Anthropic from '@anthropic-ai/sdk'
import type { MediaAnalysis, BrandContext, EditInstructions, ThoughtBlock } from '../types'
import type { TopPost } from './socialManager'
import type { TranscriptResult } from './transcriber'

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

// ── Step 1: Break transcript into semantic thought blocks ─────────────────────

export async function getThoughtBlocks(
  transcript: TranscriptResult,
  videoDuration: number,
): Promise<ThoughtBlock[]> {
  const client = getClient()

  const segmentList = transcript.segments
    .map((s) => `[${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s] "${s.text}"`)
    .join('\n')

  const prompt = `You are analyzing a video transcript to identify natural story blocks.

Video duration: ${videoDuration.toFixed(1)}s

Timestamped transcript:
${segmentList}

Group this transcript into 4–8 semantic blocks — each block is one complete, self-contained idea or story beat. A viewer who watched only that block should understand what point is being made.

Rules:
- Block boundaries MUST land exactly on a segment boundary (use the → timestamps as your only valid split points)
- Blocks must cover the entire video with no gaps and no overlaps — first block starts at ${transcript.segments[0].start.toFixed(2)}, last block ends at ${transcript.segments[transcript.segments.length - 1].end.toFixed(2)}
- Minimum block duration: 3 seconds
- Index blocks starting from 0

Return ONLY valid JSON:
{
  "blocks": [
    {
      "index": 0,
      "start": <number>,
      "end": <number>,
      "summary": "<one sentence: what this block covers — e.g. 'Introduces the problem: OFFSET pagination slowing at scale'>",
      "text": "<full transcript text for this block, concatenated>"
    }
  ]
}`

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return thought blocks JSON')
  const parsed = JSON.parse(jsonMatch[0]) as { blocks: ThoughtBlock[] }
  return parsed.blocks
}

// ── Step 2: Choose which blocks go in each version ────────────────────────────

export async function getEditInstructions(
  blocks: ThoughtBlock[],
  videoDuration: number,
  platform: string,
): Promise<EditInstructions> {
  const client = getClient()

  const blockList = blocks
    .map((b) => `Block ${b.index} [${b.start.toFixed(1)}s–${b.end.toFixed(1)}s]: "${b.summary}"\n  Text: "${b.text}"`)
    .join('\n\n')

  const targetD = Math.round(videoDuration * 0.5)

  const prompt = `You are a professional video editor creating 3 versions of a short-form video for ${platform}.

The video has been broken into the following semantic blocks:

${blockList}

Total duration: ${videoDuration.toFixed(1)}s

Create 3 versions by selecting and reordering complete blocks:

VERSION B — "Hook B"
Pick the single most scroll-stopping block as the opener. Then include ONLY the blocks that are genuinely necessary for the story to make sense from that point — drop any setup or context blocks that the viewer no longer needs because the hook already established the premise. The result can be shorter than the original if the skipped blocks were just setup.

VERSION C — "Hook C"
Pick a DIFFERENT strong hook block (not the same as Version B). Apply the same logic — only include blocks needed for the story to hold after that hook. This version should aim to be noticeably shorter than Version B by being more selective about which context blocks to keep.

VERSION D — "Tight Cut" (target ~${targetD}s)
Keep the original block order. Drop the weakest/slowest blocks to roughly halve the length. Do not reorder.

Rules:
- Use only complete blocks — no partial blocks, no timestamp splicing
- Each block can appear at most once per version
- Every version must make narrative sense as a standalone video
- A viewer who starts at the hook block should be able to follow along without missing context — if a skipped block is truly needed, keep it; if it was just intro setup that the hook made redundant, drop it
- block_sequence contains block index numbers in playback order

Return ONLY valid JSON:
{
  "video_duration": ${videoDuration.toFixed(1)},
  "hook_b": {
    "reason": "<one sentence: which block opens it and why it's the strongest hook>",
    "block_sequence": [<block indices in order>]
  },
  "hook_c": {
    "reason": "<one sentence: which block opens it and why it's a strong alternative hook>",
    "block_sequence": [<block indices in order>]
  },
  "tight_cut": {
    "block_sequence": [<block indices in order, original ordering preserved>]
  }
}`

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude did not return edit instructions JSON')
  return JSON.parse(jsonMatch[0]) as EditInstructions
}

// ── Step 3: Validate narrative coherence of each version ──────────────────────

export async function validateEditInstructions(
  blocks: ThoughtBlock[],
  instructions: EditInstructions,
): Promise<EditInstructions> {
  const client = getClient()

  const blockMap = new Map(blocks.map((b) => [b.index, b]))

  function assembleText(sequence: number[]): string {
    return sequence.map((i) => blockMap.get(i)?.text ?? '').join(' ')
  }

  const versions = [
    { name: 'hook_b', reason: instructions.hook_b.reason, sequence: instructions.hook_b.block_sequence },
    { name: 'hook_c', reason: instructions.hook_c.reason, sequence: instructions.hook_c.block_sequence },
    { name: 'tight_cut', reason: 'Tight cut', sequence: instructions.tight_cut.block_sequence },
  ]

  const blockSummaries = blocks.map((b) => `Block ${b.index}: "${b.summary}"`).join('\n')

  const versionDescriptions = versions.map((v) => `
${v.name} — sequence: [${v.sequence.join(', ')}]
Assembled text: "${assembleText(v.sequence)}"`).join('\n')

  const prompt = `You are reviewing 3 edited versions of a video for narrative coherence.

Available blocks:
${blockSummaries}

${versionDescriptions}

For each version, check:
1. Does it make sense without prior context? A new viewer should follow the story.
2. Does any sentence reference something not yet shown? (e.g. "as I mentioned", "compare this to", "unlike before")
3. Is there a clear arc — does it build to something or resolve a question?

If a version has a coherence problem, return a corrected block_sequence using only the blocks already in that version (you may reorder or drop one, but do not add new blocks).
If a version is fine, return the same sequence unchanged.

Return ONLY valid JSON:
{
  "hook_b": { "ok": <true/false>, "issue": "<what's wrong or 'none'>", "block_sequence": [<corrected or same>] },
  "hook_c": { "ok": <true/false>, "issue": "<what's wrong or 'none'>", "block_sequence": [<corrected or same>] },
  "tight_cut": { "ok": <true/false>, "issue": "<what's wrong or 'none'>", "block_sequence": [<corrected or same>] }
}`

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return instructions // fall back to original if validation fails

  const validated = JSON.parse(jsonMatch[0]) as {
    hook_b: { ok: boolean; block_sequence: number[] }
    hook_c: { ok: boolean; block_sequence: number[] }
    tight_cut: { ok: boolean; block_sequence: number[] }
  }

  return {
    video_duration: instructions.video_duration,
    hook_b: { reason: instructions.hook_b.reason, block_sequence: validated.hook_b.block_sequence },
    hook_c: { reason: instructions.hook_c.reason, block_sequence: validated.hook_c.block_sequence },
    tight_cut: { block_sequence: validated.tight_cut.block_sequence },
  }
}
