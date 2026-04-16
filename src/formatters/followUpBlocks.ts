import type { KnownBlock } from '@slack/bolt'
import type { ThoughtBlock } from '../types'

export function buildPredictionBlocks(
  reasoning: string,
  estimatedScoreDelta: number | null,
  currentScore: number,
): KnownBlock[] {
  const deltaText = estimatedScoreDelta === null
    ? 'Hard to predict without seeing it'
    : estimatedScoreDelta > 0
      ? `+${estimatedScoreDelta} pts (${currentScore} → ${currentScore + estimatedScoreDelta})`
      : estimatedScoreDelta < 0
        ? `${estimatedScoreDelta} pts (${currentScore} → ${currentScore + estimatedScoreDelta})`
        : 'Likely neutral impact'

  const deltaEmoji = estimatedScoreDelta === null ? ':grey_question:'
    : estimatedScoreDelta > 5 ? ':arrow_upper_right:'
    : estimatedScoreDelta > 0 ? ':arrow_right:'
    : estimatedScoreDelta < -5 ? ':arrow_lower_right:'
    : estimatedScoreDelta < 0 ? ':arrow_right:'
    : ':left_right_arrow:'

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${deltaEmoji} *Estimated score impact:* ${deltaText}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: reasoning },
    },
  ]
}

export function buildNewEditCaptionText(
  label: string,
  reason: string,
  blockSequence: number[],
  thoughtBlocks: ThoughtBlock[],
): string {
  const blockMap = new Map(thoughtBlocks.map((b) => [b.index, b]))
  const blockDesc = blockSequence
    .map((i) => {
      const b = blockMap.get(i)
      return b ? `Block ${i} (${b.start.toFixed(1)}s–${b.end.toFixed(1)}s)` : `Block ${i}`
    })
    .join(' → ')
  return `*${label}* — ${reason}\n_Blocks: ${blockDesc}_`
}
