export interface MediaAnalysis {
  content_type: string
  overall_score: number
  hook_strength: number
  visual_quality: number
  platform_fit: number
  predicted_views_low: number
  predicted_views_high: number
  predicted_engagement_low: number
  predicted_engagement_high: number
  summary: string
  strengths: string[]
  improvements: { issue: string; fix: string }[]
  reframe_suggestions: string[]
  caption_suggestions: string[]
  inspiration_alignment?: string[]
}

export interface VideoSegment {
  start: number
  end: number
}

export interface ThoughtBlock {
  index: number
  start: number
  end: number
  summary: string  // one-line description of what this block covers
  text: string     // full transcript text for this block
}

export interface EditInstructions {
  video_duration: number
  hook_b: {
    reason: string
    block_sequence: number[]  // ordered block indices, e.g. [2, 0, 1, 3]
  }
  hook_c: {
    reason: string
    block_sequence: number[]
  }
  tight_cut: {
    block_sequence: number[]
  }
}

export interface BrandContext {
  brand_name: string
  niche: string
  tone: string
}

export type Platform = 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'youtube' | 'youtube_long' | 'facebook'

export const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'twitter', 'linkedin', 'youtube', 'youtube_long', 'facebook']

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  youtube_long: 'YouTube',
  facebook: 'Facebook',
}

export const PLATFORM_DEFAULT_FORMAT: Record<Platform, string> = {
  instagram: 'Reel',
  tiktok: 'Short Video',
  twitter: 'Video',
  linkedin: 'Video',
  youtube: 'Short',
  youtube_long: 'Long-form Video',
  facebook: 'Reel',
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ThreadSession {
  threadTs: string
  channelId: string
  platform: Platform
  analysis: MediaAnalysis
  thoughtBlocks: ThoughtBlock[]
  editInstructions: EditInstructions
  localFilePath: string
  conversationHistory: ConversationTurn[]
  createdAt: number
  lastActivityAt: number
}
