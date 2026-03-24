import type { BrandContext } from '../types'

export interface TopPost {
  format: string
  content: string
  score: number | null
  likes: number
  comments: number
  shares: number
  reach: number
  posted_at: string
}

export interface AnalysisContext {
  brand: BrandContext
  topPosts: TopPost[]
}

export async function getAnalysisContext(platform: string): Promise<AnalysisContext | null> {
  const url = process.env.SOCIAL_MANAGER_URL
  const secret = process.env.SOCIAL_MANAGER_API_SECRET

  if (!url || !secret) return null

  try {
    const res = await fetch(`${url}/api/internal/context?platform=${platform}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })

    if (!res.ok) {
      console.warn(`[socialManager] context fetch failed: ${res.status}`)
      return null
    }

    const json = await res.json() as { brand: BrandContext; top_posts: TopPost[] }
    return { brand: json.brand, topPosts: json.top_posts }
  } catch (err) {
    console.warn('[socialManager] fetch error:', err)
    return null
  }
}
