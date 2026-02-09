const MAX_CONTEXT_MESSAGES = 5
const MAX_CONTEXT_CHARS = 2000
const FALLBACK_RECENT_MESSAGES = 2

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'were', 'have', 'has',
  'had', 'you', 'your', 'are', 'was', 'but', 'not', 'what', 'when', 'where',
  'who', 'why', 'how', 'can', 'could', 'should', 'would', 'will', 'just',
  'about', 'into', 'over', 'then', 'than', 'too', 'very', 'also', 'like',
  'it', 'its', 'they', 'them', 'their', 'there', 'here', 'such', 'some',
  'any', 'all', 'each', 'other', 'only', 'more', 'most', 'much', 'many',
])

export type AiMessageRow = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

function overlapScore(tokens: string[], queryTokens: Set<string>): number {
  let score = 0
  for (const token of tokens) {
    if (queryTokens.has(token)) {
      score += 1
    }
  }
  return score
}

export function pickContextMessages(
  messages: AiMessageRow[],
  currentMessageId: string | null
): { currentMessage: AiMessageRow | null; contextMessages: AiMessageRow[] } {
  const userMessages = messages.filter((msg) => msg.role === 'user')
  if (userMessages.length === 0) {
    return { currentMessage: null, contextMessages: [] }
  }

  let currentMessage = currentMessageId
    ? userMessages.find((msg) => msg.id === currentMessageId) || null
    : null

  if (!currentMessage) {
    currentMessage = userMessages[userMessages.length - 1]
  }

  const queryTokens = new Set(tokenize(currentMessage.content))
  const candidates = userMessages.filter((msg) => msg.id !== currentMessage.id)

  const scored = candidates.map((msg, index) => {
    const tokens = tokenize(msg.content)
    const overlap = overlapScore(tokens, queryTokens)
    const recencyWeight = candidates.length > 1 ? index / (candidates.length - 1) : 0
    return {
      msg,
      overlap,
      score: overlap + recencyWeight * 0.1,
    }
  })

  let contextCandidates: AiMessageRow[] = []
  const relevant = scored.filter((item) => item.overlap > 0).sort((a, b) => b.score - a.score)

  if (relevant.length > 0) {
    contextCandidates = relevant.slice(0, MAX_CONTEXT_MESSAGES).map((item) => item.msg)
  } else if (candidates.length > 0) {
    contextCandidates = candidates.slice(-FALLBACK_RECENT_MESSAGES)
  }

  if (contextCandidates.length === 0) {
    return { currentMessage, contextMessages: [] }
  }

  const contextByPriority = relevant.length > 0
    ? relevant.slice(0, MAX_CONTEXT_MESSAGES).map((item) => item.msg)
    : contextCandidates

  const trimmed: AiMessageRow[] = []
  let totalChars = 0

  for (const msg of contextByPriority) {
    if (totalChars + msg.content.length > MAX_CONTEXT_CHARS) {
      continue
    }
    trimmed.push(msg)
    totalChars += msg.content.length
  }

  const finalContext = (trimmed.length > 0 ? trimmed : contextCandidates)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  return { currentMessage, contextMessages: finalContext }
}
