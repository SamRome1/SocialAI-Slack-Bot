import type { TopPost } from '../services/socialManager'

// Top performing Supabase YouTube videos — update with real data from YouTube Studio.
// Fields: content = video title, reach = view count, likes, comments, posted_at = publish date (ISO).
export const youtubeTopVideos: TopPost[] = [
  {
    format: 'Long-form Video',
    content: '5 tips to make you a pro at Cursor',
    score: null,
    likes: 2500,
    comments: 190,
    average_watch_time: 226, // in seconds
    reach: 1100000,
    posted_at: '2025-06-18',
  },
  // Add up to 10 entries. Example:
  {
    format: 'Long-form Video',
    content: 'Building a SaaS with Lovable, Supabase, and Stripe',
    score: null,
    likes: 2100,
    comments: 93,
    average_watch_time: 370, // in seconds
    reach: 875000,
    posted_at: '2025-01-14',
  },
  {
    format: 'Long-form Video',
    content: 'Supabase Explained',
    score: null,
    likes: 3500,
    comments: 129,
    average_watch_time: 146, // in seconds
    reach: 982000,
    posted_at: '2025-02-18',
  },
  {
    format: 'Long-form Video',
    content: 'Supabase is now GA',
    score: null,
    likes: 2700,
    comments: 158,
    average_watch_time: 75, // in seconds
    reach: 711000,
    posted_at: '2024-04-15',
  },
  {
    format: 'Long-form Video',
    content: 'Whats the ID????',
    score: null,
    likes: 1300,
    comments: 43,
    average_watch_time: 23, // in seconds
    reach: 178000,
    posted_at: '2025-05-21',
  },
  {
    format: 'Long-form Video',
    content: 'How to use Cursor Agent and Supabase to Maximize Productivity',
    score: null,
    likes: 1900,
    comments: 190,
    average_watch_time: 335, // in seconds
    reach: 654000,
    posted_at: '2025-02-26',
  },
  {
    format: 'Long-form Video',
    content: 'The missing pieces to your AI app (pgvector + RAG in prod)',
    score: null,
    likes: 2100,
    comments: 138,
    average_watch_time: 470, // in seconds
    reach: 505000,
    posted_at: '2023-11-21',
  },
  {
    format: 'Long-form Video',
    content: 'Sign in with Google on Expo React Native',
    score: null,
    likes: 851,
    comments: 137,
    average_watch_time: 192, // in seconds
    reach: 372000,
    posted_at: '2023-10-5',
  },
  {
    format: 'Long-form Video',
    content: 'Implement Authorization usiing Row Level Security (RLS) with Supabase (Step By Step Guide)',
    score: null,
    likes: 2200,
    comments: 128,
    average_watch_time: 286, // in seconds
    reach: 870000,
    posted_at: '2021-09-03',
  }
]
